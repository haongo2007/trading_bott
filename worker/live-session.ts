import { randomUUID } from "node:crypto";
import type { BrowserContext, CDPSession, Page } from "playwright";
import type { WebSocket } from "ws";
import type { TradingAccount } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { decrypt, encrypt } from "@/lib/crypto";
import type { ClientMsg, LiveMode, RecordedStep, SelectorCandidate, ServerMsg } from "@/lib/live-protocol";
import { log, newAccountContext, unlockAccount } from "./browser-pool";
import { ensureLoggedIn, isLoggedIn, readBalance } from "./login";
import { inspectActiveElement, inspectAtPoint, type InspectResult } from "./page-scripts";

const IDLE_MS = Number(process.env.LIVE_IDLE_MINUTES ?? 10) * 60_000;
const MAX_BUFFERED = 4 * 1024 * 1024; // bỏ khung hình nếu mạng phía client chậm
const ALLOWED_KEYS = new Set([
  "Enter", "Backspace", "Tab", "Escape", "Delete", "Home", "End", "PageUp", "PageDown",
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Control+a", "Meta+a",
]);

export class LiveSession {
  readonly owner = `live:${randomUUID()}`;
  private context!: BrowserContext;
  private page!: Page;
  private cdp: CDPSession | null = null;
  private mode: LiveMode = "interact";
  private typedSinceFlush = false;
  private hoverBusy = false;
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private idleTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private username = "";

  constructor(
    private ws: WebSocket,
    private account: TradingAccount,
  ) {}

  async start() {
    this.username = decrypt(this.account.usernameEnc);
    this.context = await newAccountContext(this.account);
    if (this.closed) {
      // client đã ngắt trong lúc đang mở trình duyệt
      await this.context.close().catch(() => {});
      throw new Error("Client đã ngắt kết nối");
    }
    this.context.on("page", (p) => {
      // popup / tab mới → chuyển canvas sang tab đó
      this.attach(p).catch(() => {});
    });
    const page = await this.context.newPage();
    await this.attach(page);

    this.ws.on("message", (raw, isBinary) => {
      if (isBinary) return;
      let msg: ClientMsg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      this.touch();
      // Xử lý TUẦN TỰ: phím gõ phải chạy sau khi click (focus ô nhập) đã xong.
      // Riêng di chuột: bỏ qua khi hàng đợi đang dồn để không trễ.
      if (msg.t === "move" && this.pending > 1) return;
      this.pending++;
      this.queue = this.queue
        .then(() => this.handle(msg))
        .catch((e) => this.toast("error", (e as Error).message.split("\n")[0]))
        .finally(() => this.pending--);
    });
    this.ws.on("close", () => this.close("client closed"));

    this.send({ t: "ready", viewport: { width: this.account.viewportWidth, height: this.account.viewportHeight } });
    this.touch();
    const startUrl = this.account.storageStateEnc ? this.account.tradeUrl : this.account.loginUrl;
    await this.page.goto(startUrl, { waitUntil: "domcontentloaded" }).catch((e) => this.toast("error", e.message));
    log("live", this.account.id, "Mở phiên trình duyệt trực tiếp");
  }

  private async attach(page: Page) {
    if (this.cdp) await this.cdp.send("Page.stopScreencast").catch(() => {});
    await this.cdp?.detach().catch(() => {});
    this.page = page;

    page.on("framenavigated", async (frame) => {
      if (frame === page.mainFrame() && page === this.page) {
        this.send({ t: "url", url: page.url(), title: await page.title().catch(() => "") });
      }
    });
    page.on("close", () => {
      if (page !== this.page || this.closed) return;
      const remaining = this.context.pages();
      if (remaining.length) this.attach(remaining[remaining.length - 1]).catch(() => {});
    });

    const cdp = await this.context.newCDPSession(page);
    this.cdp = cdp;
    cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
      if (this.ws.readyState === this.ws.OPEN && this.ws.bufferedAmount < MAX_BUFFERED) {
        this.ws.send(Buffer.from(data, "base64"), { binary: true });
      }
      cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 70,
      maxWidth: this.account.viewportWidth,
      maxHeight: this.account.viewportHeight,
    });
    if (page.url() !== "about:blank") this.send({ t: "url", url: page.url(), title: await page.title() });
  }

  private async handle(msg: ClientMsg) {
    const page = this.page;
    switch (msg.t) {
      case "navigate": {
        const url = normalizeUrl(msg.url);
        if (!url) return this.toast("error", "URL không hợp lệ (chỉ hỗ trợ http/https)");
        await this.flushTyping();
        await page.goto(url, { waitUntil: "domcontentloaded" });
        if (this.mode === "record") this.step({ action: "goto", url, label: `Mở ${url}` });
        return;
      }
      case "back":
        await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
        return;
      case "forward":
        await page.goForward({ waitUntil: "domcontentloaded" }).catch(() => {});
        return;
      case "reload":
        await page.reload({ waitUntil: "domcontentloaded" });
        return;

      case "move": {
        if (this.mode === "pick") {
          if (this.hoverBusy) return;
          this.hoverBusy = true;
          try {
            const r = (await page.evaluate(inspectAtPoint(msg.x, msg.y, true)).catch(() => null)) as InspectResult;
            this.send({ t: "hover", rect: r?.rect ?? null });
          } finally {
            this.hoverBusy = false;
          }
        } else {
          await page.mouse.move(msg.x, msg.y);
        }
        return;
      }

      case "click": {
        if (this.mode === "pick") {
          const info = (await page.evaluate(inspectAtPoint(msg.x, msg.y))) as InspectResult;
          if (!info) return this.toast("info", "Không có phần tử tại vị trí này");
          const selectors = await this.rankSelectors(info.candidates);
          this.send({ t: "picked", element: { tag: info.tag, type: info.type, text: info.text, rect: info.rect, selectors } });
          return;
        }
        // Mỗi sự kiện click của canvas = 1 lần nhấn chuột với đúng "detail" của nó
        // → double/triple-click hoạt động như trình duyệt thật (VD triple-click chọn hết chữ).
        const detail = Math.min(Math.max(Math.round(msg.detail ?? 1), 1), 3);
        if (this.mode === "record" && detail === 1) {
          await this.flushTyping();
          const info = (await page.evaluate(inspectAtPoint(msg.x, msg.y))) as InspectResult;
          if (info) {
            const best = (await this.rankSelectors(info.candidates))[0];
            if (best) this.step({ action: "click", selector: best.selector, label: `Click ${describe(info)}` });
          }
        }
        await page.mouse.move(msg.x, msg.y);
        await page.mouse.down({ clickCount: detail });
        await page.mouse.up({ clickCount: detail });
        return;
      }

      case "wheel":
        await page.mouse.move(msg.x, msg.y);
        await page.mouse.wheel(clamp(msg.dx, -2000, 2000), clamp(msg.dy, -2000, 2000));
        return;

      case "text":
        if (this.mode === "pick") return;
        await page.keyboard.type(msg.text.slice(0, 2000));
        this.typedSinceFlush = true;
        return;

      case "key":
        if (this.mode === "pick" || !ALLOWED_KEYS.has(msg.key)) return;
        if (this.mode === "record" && (msg.key === "Enter" || msg.key === "Tab")) {
          await this.flushTyping();
          this.step({ action: "press", key: msg.key, label: `Nhấn phím ${msg.key}` });
        } else if (msg.key !== "Enter" && msg.key !== "Tab") {
          this.typedSinceFlush = true;
        }
        await page.keyboard.press(msg.key);
        return;

      case "mode":
        await this.flushTyping();
        this.mode = msg.mode;
        if (msg.mode !== "pick") this.send({ t: "hover", rect: null });
        return;

      case "testSelector": {
        const selector = msg.selector.trim().slice(0, 1024);
        try {
          const loc = page.locator(selector);
          const count = await loc.count();
          const box = count ? await loc.first().boundingBox() : null;
          this.send({
            t: "selectorTest",
            selector,
            count,
            rect: box ? { x: box.x, y: box.y, w: box.width, h: box.height } : null,
          });
        } catch (e) {
          this.send({ t: "selectorTest", selector, count: 0, rect: null, error: (e as Error).message.split("\n")[0] });
        }
        return;
      }

      case "autoLogin": {
        this.send({ t: "busy", busy: true });
        try {
          const fresh = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: this.account.id } });
          this.account = fresh;
          const via = await ensureLoggedIn(page, { ...fresh, storageStateEnc: null });
          const { balanceText } = await readBalance(page, fresh);
          this.toast("success", `Đăng nhập thành công (${via})${balanceText ? ` — số dư: ${balanceText}` : ""}`);
        } finally {
          this.send({ t: "busy", busy: false });
        }
        return;
      }

      case "saveSession": {
        const fresh = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: this.account.id } });
        this.account = fresh;
        const ok = await isLoggedIn(page, fresh, 3000);
        const { balance } = ok ? await readBalance(page, fresh) : { balance: null };
        const state = await this.context.storageState();
        await prisma.tradingAccount.update({
          where: { id: fresh.id },
          data: {
            storageStateEnc: encrypt(JSON.stringify(state)),
            ...(ok && {
              status: fresh.status === "DISABLED" ? "DISABLED" : "ACTIVE",
              lastLoginAt: new Date(),
              lastError: null,
              ...(balance != null && { lastBalance: balance }),
            }),
          },
        });
        this.toast(
          ok ? "success" : "info",
          ok
            ? "Đã lưu phiên đăng nhập. Bot sẽ dùng lại phiên này."
            : "Đã lưu phiên, nhưng chưa xác nhận được trạng thái đăng nhập (kiểm tra selector “Dấu hiệu đã đăng nhập”).",
        );
        return;
      }
    }
  }

  /** Kiểm tra mỗi selector khớp bao nhiêu phần tử; selector duy nhất lên đầu. */
  private async rankSelectors(candidates: string[]): Promise<SelectorCandidate[]> {
    const out: SelectorCandidate[] = [];
    for (const selector of candidates.slice(0, 10)) {
      const count = await this.page.locator(selector).count().catch(() => -1);
      if (count > 0) out.push({ selector, count });
    }
    return out.sort((a, b) => Number(b.count === 1) - Number(a.count === 1)).slice(0, 6);
  }

  /** Ghi bước "fill" cho ô đang focus nếu người dùng vừa gõ phím. */
  private async flushTyping() {
    if (!this.typedSinceFlush || this.mode !== "record") {
      this.typedSinceFlush = false;
      return;
    }
    this.typedSinceFlush = false;
    const info = (await this.page.evaluate(inspectActiveElement()).catch(() => null)) as InspectResult;
    if (!info || info.value == null) return;
    const best = (await this.rankSelectors(info.candidates))[0];
    if (!best) return;
    const value = info.type === "password" ? "{{password}}" : info.value === this.username ? "{{username}}" : info.value;
    this.step({ action: "fill", selector: best.selector, value, label: `Nhập vào ${describe(info)}` });
  }

  private step(s: Omit<RecordedStep, "id">) {
    this.send({ t: "step", step: { id: randomUUID(), ...s } });
  }

  private toast(level: "info" | "success" | "error", message: string) {
    this.send({ t: "toast", level, message });
  }

  private send(msg: ServerMsg) {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private touch() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.ws.close(4408, "idle");
      this.close("idle");
    }, IDLE_MS);
  }

  async close(reason: string) {
    if (this.closed) return;
    this.closed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    await this.cdp?.send("Page.stopScreencast").catch(() => {});
    await this.context?.close().catch(() => {});
    unlockAccount(this.account.id, this.owner);
    log("live", this.account.id, "Đóng phiên:", reason);
  }
}

function normalizeUrl(raw: string): string | null {
  const v = raw.trim();
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function describe(info: NonNullable<InspectResult>) {
  const t = info.text ? ` “${info.text.slice(0, 30)}”` : "";
  return `<${info.tag}${info.type ? ` type=${info.type}` : ""}>${t}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : 0));
}
