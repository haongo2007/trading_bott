import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { parseBalance } from "@/lib/balance";
import {
  evalCondition, flowGraphSchema, MAX_FLOW_STEPS, nextNodeId, nodeTitle, renderTemplate, validateFlow,
  type FlowGraph, type FlowNode, type FlowRunResult, type RunLogEntry,
} from "@/lib/flow";
import { log, newAccountContext } from "./browser-pool";
import { ensureLoggedIn, saveStorageState } from "./login";

const STORAGE_DIR = process.env.STORAGE_DIR ?? "storage";
const DEFAULT_TIMEOUT = 10_000;
const MAX_RUN_MS = 10 * 60_000;

export type RunFlowPayload = { flowId: string; dryRun: boolean; loginFirst: boolean };
export type FlowVars = Record<string, string | number>;

export class CancelledError extends Error {}

/** Lỗi trong khối Đặt lệnh SAU khi đã bấm nút — trạng thái lệnh không chắc chắn. */
export class OrderUncertainError extends Error {}

export function loadGraph(raw: unknown): FlowGraph {
  const parsed = flowGraphSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Dữ liệu flow không hợp lệ");
  const graph = parsed.data as FlowGraph;
  const problems = validateFlow(graph);
  if (problems.length) throw new Error(`Flow chưa hợp lệ: ${problems[0].message}`);
  return graph;
}

export function accountVars(account: { usernameEnc: string; passwordEnc: string; loginUrl: string; tradeUrl: string }): FlowVars {
  return {
    username: decrypt(account.usernameEnc),
    password: decrypt(account.passwordEnc),
    loginUrl: account.loginUrl,
    tradeUrl: account.tradeUrl,
  };
}

export const publicVars = (vars: FlowVars) => Object.fromEntries(Object.entries(vars).filter(([k]) => k !== "password" && k !== "username"));

export type RunGraphOptions = {
  dryRun: boolean;
  isCancelled: () => Promise<boolean>;
  /** Chụp màn hình sau mỗi bước (trả về đường dẫn tương đối) — bỏ qua nếu không truyền. */
  shoot?: (seq: number) => Promise<string | undefined>;
  onStep?: (entry: RunLogEntry | null, currentNodeId: string | null) => Promise<void>;
  seqOffset?: number;
};

export type RunGraphResult = { ok: boolean; error?: string; cancelled?: boolean; logs: RunLogEntry[]; orderPlaced: boolean; orderSkipped: boolean };

/** Chạy một flow trên page có sẵn. Dùng cho cả “Chạy thử flow” lẫn mỗi lệnh của bot. */
export async function runGraph(page: Page, graph: FlowGraph, vars: FlowVars, opts: RunGraphOptions): Promise<RunGraphResult> {
  const logs: RunLogEntry[] = [];
  const state = { orderPlaced: false, orderSkipped: false };
  const startedAt = Date.now();
  let nodeId: string | null = graph.nodes.find((n) => n.type === "start")!.id;
  let seq = opts.seqOffset ?? 0;
  let steps = 0;

  try {
    while (nodeId) {
      if (++steps > MAX_FLOW_STEPS) throw new Error(`Vượt quá ${MAX_FLOW_STEPS} bước — flow có vòng lặp vô hạn?`);
      if (Date.now() - startedAt > MAX_RUN_MS) throw new Error("Vượt quá thời gian chạy tối đa (10 phút)");
      if (await opts.isCancelled()) throw new CancelledError("Đã dừng theo yêu cầu");

      const node: FlowNode | undefined = graph.nodes.find((n) => n.id === nodeId);
      if (!node) throw new Error(`Không tìm thấy khối ${nodeId}`);
      seq++;
      await opts.onStep?.(null, node.id);

      const entry: RunLogEntry = { seq, nodeId: node.id, type: node.type, title: nodeTitle(node), status: "ok", message: "", ms: 0 };
      const t0 = Date.now();
      let handle = "next";
      try {
        const out = await executeNode(page, node, vars, opts.dryRun, opts.isCancelled, state);
        entry.status = out.skipped ? "skipped" : "ok";
        entry.message = out.message;
        if (out.handle) handle = out.handle;
      } catch (e) {
        if (e instanceof CancelledError || e instanceof OrderUncertainError) {
          entry.status = "error";
          entry.message = (e as Error).message;
          entry.ms = Date.now() - t0;
          entry.screenshot = await opts.shoot?.(seq);
          logs.push(entry);
          throw e;
        }
        entry.status = "error";
        entry.message = friendlyError(e, node);
        if (!node.data.optional || node.type === "order") {
          entry.ms = Date.now() - t0;
          entry.screenshot = await opts.shoot?.(seq);
          logs.push(entry);
          throw new Error(`${entry.title}: ${entry.message}`);
        }
        entry.status = "skipped";
        entry.message += " (bỏ qua vì khối được đánh dấu “không bắt buộc”)";
      }
      entry.ms = Date.now() - t0;
      if (!["start", "end", "wait"].includes(node.type)) entry.screenshot = await opts.shoot?.(seq);
      logs.push(entry);
      await opts.onStep?.(entry, node.id);

      if (node.type === "end") break;
      nodeId = nextNodeId(graph, node.id, handle);
    }
    return { ok: true, logs, ...state };
  } catch (e) {
    return {
      ok: false,
      error: (e as Error).message.split("\n")[0],
      cancelled: e instanceof CancelledError,
      logs,
      ...state,
      // lỗi "không chắc chắn" sau khi bấm đặt lệnh → coi như có thể đã đặt
      orderPlaced: state.orderPlaced || e instanceof OrderUncertainError,
    };
  }
}

export async function makeShooter(page: Page, dirParts: string[]) {
  const dir = path.join(STORAGE_DIR, ...dirParts);
  await mkdir(dir, { recursive: true });
  return async (seq: number) => {
    const rel = path.join(...dirParts, `${String(seq).padStart(4, "0")}.jpg`);
    return page
      .screenshot({ path: path.join(STORAGE_DIR, rel), type: "jpeg", quality: 60 })
      .then(() => rel)
      .catch(() => undefined);
  };
}

/** Chạy flow cho lệnh RUN_FLOW. Tiến độ được ghi liên tục vào Command.result để UI theo dõi. */
export async function runFlowCommand(commandId: string, accountId: string, payload: RunFlowPayload): Promise<FlowRunResult> {
  const result: FlowRunResult & { cancelled?: boolean } = { phase: "login", logs: [], currentNodeId: null };
  const report = async () => {
    // Chỉ ghi khi lệnh còn PROCESSING (không ghi đè trạng thái CANCELLED)
    await prisma.command.updateMany({ where: { id: commandId, status: "PROCESSING" }, data: { result: JSON.stringify(result) } });
  };
  const isCancelled = async () =>
    (await prisma.command.findUnique({ where: { id: commandId }, select: { status: true } }))?.status === "CANCELLED";

  const flow = await prisma.flow.findUnique({ where: { id: payload.flowId } });
  if (!flow) return { ...result, phase: "done", ok: false, error: "Không tìm thấy flow" };
  let graph: FlowGraph;
  try {
    graph = loadGraph(flow.graph);
  } catch (e) {
    return { ...result, phase: "done", ok: false, error: (e as Error).message };
  }

  const account = await prisma.tradingAccount.findUnique({ where: { id: accountId } });
  if (!account) return { ...result, phase: "done", ok: false, error: "Không tìm thấy tài khoản" };
  if (account.status === "DISABLED") return { ...result, phase: "done", ok: false, error: "Tài khoản đang tạm khoá" };

  // Khi chạy thử flow riêng lẻ: giá trị mẫu cho khối Đặt lệnh
  const vars: FlowVars = { ...accountVars(account), amount: 10_000, direction: "UP" };
  const context = await newAccountContext(account);
  const page = await context.newPage();
  const shoot = await makeShooter(page, ["runs", commandId]);

  try {
    if (payload.loginFirst) {
      await report();
      const t0 = Date.now();
      const via = await ensureLoggedIn(page, account);
      await saveStorageState(context, account.id);
      result.logs.push({
        seq: 0, nodeId: "__login", type: "start", title: "Đăng nhập", status: "ok",
        message: via === "SESSION" ? "Dùng phiên đã lưu" : "Đăng nhập bằng form", ms: Date.now() - t0, screenshot: await shoot(0),
      });
    }
    result.phase = "running";
    const out = await runGraph(page, graph, vars, {
      dryRun: payload.dryRun,
      isCancelled,
      shoot,
      onStep: async (entry, current) => {
        if (entry) result.logs.push(entry);
        result.currentNodeId = current;
        result.vars = publicVars(vars);
        await report();
      },
    });
    result.ok = out.ok;
    result.error = out.error;
    result.cancelled = out.cancelled;
    // runGraph không gọi onStep cho bước lỗi → bổ sung bước cuối nếu thiếu
    const last = out.logs.at(-1);
    if (last && !result.logs.includes(last)) result.logs.push(last);
  } catch (e) {
    result.ok = false;
    result.error = (e as Error).message.split("\n")[0];
    result.logs.push({ seq: 9999, nodeId: "__error", type: "end", title: "Lỗi", status: "error", message: result.error, ms: 0, screenshot: await shoot(9999) });
  } finally {
    await context.close().catch(() => {});
  }
  result.phase = "done";
  result.currentNodeId = null;
  result.vars = publicVars(vars);
  log("flow", `${flow.name} trên ${account.name}: ${result.ok ? "OK" : `lỗi — ${result.error}`} (${result.logs.length} bước)`);
  return result;
}

function friendlyError(e: unknown, node: FlowNode): string {
  const msg = (e as Error).message ?? String(e);
  const sec = ((node.data.timeoutMs ?? DEFAULT_TIMEOUT) / 1000).toLocaleString("vi-VN");
  if (/Timeout \d+ms exceeded/.test(msg)) {
    if (node.type === "goto") return `Trang không tải xong trong thời gian cho phép`;
    const sel = node.data.selector ?? node.data.amountSelector ?? node.data.upSelector;
    if (sel) {
      return node.data.state === "hidden"
        ? `Phần tử ${sel} vẫn chưa biến mất sau ${sec} giây`
        : `Không thấy phần tử ${sel} hiển thị sau ${sec} giây (sai selector, trang chưa tải, hoặc phần tử chỉ xuất hiện sau khi đặt lệnh — có thể đánh dấu khối “Không bắt buộc”)`;
    }
  }
  if (/net::ERR_/.test(msg)) return `Không truy cập được trang (${msg.match(/net::ERR_[A-Z_]+/)?.[0]})`;
  if (/Unexpected token|is not a valid selector|Unknown engine/i.test(msg)) return `Selector không hợp lệ`;
  return msg.split("\n")[0];
}

async function executeNode(
  page: Page,
  node: FlowNode,
  vars: FlowVars,
  dryRun: boolean,
  isCancelled: () => Promise<boolean>,
  state: { orderPlaced: boolean; orderSkipped: boolean },
): Promise<{ message: string; skipped?: boolean; handle?: string }> {
  const d = node.data;
  const timeout = d.timeoutMs ?? DEFAULT_TIMEOUT;
  const loc = () => page.locator(d.selector!).first();

  switch (node.type) {
    case "start":
      return { message: "Bắt đầu" };
    case "end":
      return { message: "Kết thúc flow" };

    case "goto": {
      const url = renderTemplate(d.url!, vars);
      if (!/^https?:\/\//i.test(url)) throw new Error(`URL không hợp lệ: ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: Math.max(timeout, 30_000) });
      return { message: url };
    }

    case "click": {
      const el = loc();
      await el.waitFor({ state: "visible", timeout });
      if (d.critical && dryRun) {
        await highlight(page, d.selector!);
        return { message: `Chạy thử: KHÔNG bấm (thao tác đặt lệnh) — đã tìm thấy ${d.selector}`, skipped: true };
      }
      await el.click({ timeout });
      return { message: d.selector! };
    }

    case "fill": {
      const raw = d.value ?? "";
      const value = renderTemplate(raw, vars);
      if (value.includes("{{")) throw new Error(`Biến chưa có giá trị trong “${raw}”`);
      const el = loc();
      await el.waitFor({ state: "visible", timeout });
      await el.fill(value, { timeout });
      const shown = /\{\{\s*password\s*\}\}/.test(raw) ? "••••••" : value;
      return { message: `${d.selector} = ${shown}` };
    }

    case "press":
      if (d.critical && dryRun) return { message: `Chạy thử: KHÔNG nhấn ${d.key} (thao tác đặt lệnh)`, skipped: true };
      await page.keyboard.press(d.key!);
      return { message: d.key! };

    case "waitFor":
      await loc().waitFor({ state: d.state ?? "visible", timeout });
      return { message: `${d.selector} đã ${d.state === "hidden" ? "ẩn" : "hiện"}` };

    case "wait": {
      const ms = Math.min(d.ms ?? 1000, 600_000);
      // Chờ theo từng nhịp 500ms để nút "Dừng" có tác dụng ngay
      const until = Date.now() + ms;
      while (Date.now() < until) {
        await page.waitForTimeout(Math.min(500, until - Date.now()));
        if (await isCancelled()) throw new CancelledError("Đã dừng theo yêu cầu");
      }
      return { message: `Đã chờ ${(ms / 1000).toLocaleString("vi-VN")} giây` };
    }

    case "readText": {
      const el = loc();
      await el.waitFor({ state: "visible", timeout });
      const text = (await el.innerText({ timeout })).trim();
      let value: string | number = text;
      if (d.parse === "number") {
        const n = parseBalance(text);
        if (n == null) throw new Error(`Không đọc được số từ “${text.slice(0, 50)}”`);
        value = n;
      }
      vars[d.saveAs!] = value;
      return { message: `{{${d.saveAs}}} = ${typeof value === "number" ? value.toLocaleString("vi-VN") : `“${value.slice(0, 80)}”`}` };
    }

    case "order": {
      const amount = Number(vars.amount);
      const direction = vars.direction;
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Thiếu số tiền {{amount}} hợp lệ");
      if (direction !== "UP" && direction !== "DOWN") throw new Error("Thiếu hướng {{direction}} (UP/DOWN)");
      if (state.orderPlaced) throw new Error("Flow đặt lệnh 2 lần trong 1 phiên — mỗi lượt bot chỉ được đặt 1 lệnh");

      if (d.amountSelector) {
        const input = page.locator(d.amountSelector).first();
        await input.waitFor({ state: "visible", timeout });
        await input.fill(String(amount), { timeout });
      }
      const btnSel = direction === "UP" ? d.upSelector! : d.downSelector!;
      const btn = page.locator(btnSel).first();
      await btn.waitFor({ state: "visible", timeout });
      const label = `${direction === "UP" ? "▲ TĂNG" : "▼ GIẢM"} ${amount.toLocaleString("vi-VN")}`;

      if (dryRun) {
        await highlight(page, btnSel);
        state.orderSkipped = true;
        return { message: `Chạy thử: KHÔNG bấm ${label} — đã tìm thấy ${btnSel}`, skipped: true };
      }
      await btn.click({ timeout });
      // Từ đây lệnh có thể đã được gửi — mọi lỗi sau đều là "không chắc chắn"
      state.orderPlaced = true;
      if (d.confirmSelector) {
        try {
          await page.locator(d.confirmSelector).first().click({ timeout });
        } catch (e) {
          throw new OrderUncertainError(`Đã bấm ${label} nhưng không bấm được nút xác nhận: ${(e as Error).message.split("\n")[0]}`);
        }
      }
      return { message: `Đã đặt ${label}` };
    }

    case "condition": {
      const ok = evalCondition(d.left!, d.op!, d.right, vars);
      return { message: `${d.left} ${d.op} ${d.op === "exists" ? "" : renderTemplate(d.right ?? "", vars)} → ${ok ? "Đúng" : "Sai"}`, handle: ok ? "true" : "false" };
    }

    case "screenshot":
      return { message: "Đã chụp màn hình" };
  }
}

async function highlight(page: Page, selector: string) {
  await page
    .locator(selector)
    .first()
    .evaluate((el: HTMLElement) => {
      el.style.outline = "4px solid #f59e0b";
      el.style.outlineOffset = "2px";
    })
    .catch(() => {});
}
