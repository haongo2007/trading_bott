import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { parseBalance } from "@/lib/balance";
import {
  evalCondition, flowGraphSchema, MAX_FLOW_STEPS, nextNodeId, nodeTitle, renderTemplate, validateFlow,
  type FlowGraph, type FlowNode, type FlowRunResult, type RunLogEntry,
} from "@/lib/flow";
import { log, newAccountContext } from "./browser-pool";
import { ensureLoggedIn, saveStorageState } from "./login";
import { locate } from "./locate";

const STORAGE_DIR = process.env.STORAGE_DIR ?? "storage";
const DEFAULT_TIMEOUT = 10_000;
const MAX_RUN_MS = 10 * 60_000;

export type RunFlowPayload = { flowId: string; dryRun: boolean; loginFirst: boolean; direction?: "UP" | "DOWN" };
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
  /**
   * Đoạn flow cần chạy (khi có khối “Mỗi lệnh bắt đầu từ đây”):
   *  - "all"   (mặc định): từ Bắt đầu đến Kết thúc, khối mốc chỉ là điểm đi qua — dùng khi chạy thử flow
   *  - "setup": từ Bắt đầu đến khối mốc rồi dừng — bot chạy 1 lần đầu phiên
   *  - "order": từ sau khối mốc đến Kết thúc — bot chạy mỗi lệnh
   */
  segment?: "all" | "setup" | "order";
};

export type RunGraphResult = { ok: boolean; error?: string; cancelled?: boolean; logs: RunLogEntry[]; orderPlaced: boolean; orderSkipped: boolean };

/**
 * orderPlaced: đã bấm một thao tác đặt lệnh (khối Đặt lệnh, hoặc Click/Nhấn phím đánh dấu “Thao tác đặt lệnh”).
 * orderNodeRan: khối Đặt lệnh đã chạy — chặn đặt 2 lệnh trong 1 lượt.
 */
type OrderState = { orderPlaced: boolean; orderSkipped: boolean; orderNodeRan: boolean };

/** Chạy một flow trên page có sẵn. Dùng cho cả “Chạy thử flow” lẫn mỗi lệnh của bot. */
export async function runGraph(page: Page, graph: FlowGraph, vars: FlowVars, opts: RunGraphOptions): Promise<RunGraphResult> {
  const logs: RunLogEntry[] = [];
  const state: OrderState = { orderPlaced: false, orderSkipped: false, orderNodeRan: false };
  const startedAt = Date.now();
  const segment = opts.segment ?? "all";
  const loopNode = graph.nodes.find((n) => n.type === "loopStart");
  let nodeId: string | null =
    segment === "order" && loopNode ? nextNodeId(graph, loopNode.id) : graph.nodes.find((n) => n.type === "start")!.id;
  let seq = opts.seqOffset ?? 0;
  let steps = 0;

  try {
    while (nodeId) {
      if (++steps > MAX_FLOW_STEPS) throw new Error(`Vượt quá ${MAX_FLOW_STEPS} bước — flow có vòng lặp vô hạn?`);
      if (Date.now() - startedAt > MAX_RUN_MS) throw new Error("Vượt quá thời gian chạy tối đa (10 phút)");
      if (await opts.isCancelled()) throw new CancelledError("Đã dừng theo yêu cầu");

      const node: FlowNode | undefined = graph.nodes.find((n) => n.id === nodeId);
      if (!node) throw new Error(`Không tìm thấy khối ${nodeId}`);
      if (node.type === "loopStart" && segment === "setup") break; // xong phần chuẩn bị
      seq++;
      await opts.onStep?.(null, node.id);

      const entry: RunLogEntry = { seq, nodeId: node.id, type: node.type, title: nodeTitle(node), status: "ok", message: "", ms: 0 };
      const t0 = Date.now();
      let handle = "next";
      try {
        const out = await executeNode(page, node, vars, opts.dryRun, opts.isCancelled, state, earlySkipSelector(graph, node, vars));
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
    return { ok: true, logs, orderPlaced: state.orderPlaced, orderSkipped: state.orderSkipped };
  } catch (e) {
    return {
      ok: false,
      error: (e as Error).message.split("\n")[0],
      cancelled: e instanceof CancelledError,
      logs,
      orderSkipped: state.orderSkipped,
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
  const vars: FlowVars = { ...accountVars(account), amount: 10_000, direction: payload.direction === "DOWN" ? "DOWN" : "UP" };
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
        message: via === "SESSION" ? "Dùng phiên đã lưu" : via === "NONE" ? "Không cần đăng nhập — mở trang giao dịch" : "Đăng nhập bằng form", ms: Date.now() - t0, screenshot: await shoot(0),
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

const WAIT_NODES = new Set(["click", "fill", "waitFor", "readText"]);

/**
 * Bỏ qua sớm: với khối “Không bắt buộc” (không phải thao tác đặt lệnh), nếu phần tử của bước NGAY SAU
 * đã hiện thì không cần chờ hết timeout của bước này — bỏ qua và đi tiếp.
 * Trả về selector của bước sau, hoặc null nếu không áp dụng.
 */
function earlySkipSelector(graph: FlowGraph, node: FlowNode, vars: FlowVars): string | null {
  if (!node.data.optional || node.data.critical || !WAIT_NODES.has(node.type)) return null;
  const nextId = nextNodeId(graph, node.id);
  const next = nextId ? graph.nodes.find((n) => n.id === nextId) : undefined;
  if (!next) return null;
  const nd = next.data;
  if (next.type === "waitFor" && nd.state === "hidden") return null;
  if (WAIT_NODES.has(next.type)) return nd.selector?.trim() || null;
  if (next.type === "order") return nd.amountSelector?.trim() || (vars.direction === "DOWN" ? nd.downSelector : nd.upSelector)?.trim() || null;
  return null;
}

/**
 * Chờ phần tử của bước hiện tại. Nếu có skipSel: đồng thời theo dõi phần tử bước sau,
 * cái nào xuất hiện trước thì thắng. Nếu cả hai đều không xuất hiện → ném lỗi của bước hiện tại.
 */
async function waitOrSkip(
  page: Page,
  own: Locator,
  state: "visible" | "hidden",
  timeout: number,
  skipSel: string | null,
): Promise<"own" | "skip"> {
  if (!skipSel) {
    await own.waitFor({ state, timeout });
    return "own";
  }
  // Phần tử của chính bước này đã sẵn sàng → luôn ưu tiên làm bước này
  if (state === "visible" && (await own.isVisible().catch(() => false))) return "own";
  const ownP = own.waitFor({ state, timeout }).then(() => "own" as const);
  const skipP = locate(page, skipSel).waitFor({ state: "visible", timeout }).then(() => "skip" as const);
  ownP.catch(() => {});
  skipP.catch(() => {});
  try {
    return await Promise.any([ownP, skipP]);
  } catch {
    return ownP; // cả hai thất bại → lỗi của bước hiện tại
  }
}

async function executeNode(
  page: Page,
  node: FlowNode,
  vars: FlowVars,
  dryRun: boolean,
  isCancelled: () => Promise<boolean>,
  state: OrderState,
  skipSel: string | null = null,
): Promise<{ message: string; skipped?: boolean; handle?: string }> {
  const d = node.data;
  const timeout = d.timeoutMs ?? DEFAULT_TIMEOUT;
  const loc = () => locate(page, d.selector!);
  const skipped = () => ({
    message: `Bỏ qua: chưa thấy ${d.selector} nhưng phần tử bước sau (${skipSel}) đã hiện`,
    skipped: true,
  });

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
      if ((await waitOrSkip(page, el, "visible", timeout, skipSel)) === "skip") return skipped();
      if (d.critical && dryRun) {
        await highlight(page, d.selector!);
        state.orderSkipped = true;
        return { message: `Chạy thử: KHÔNG bấm (thao tác đặt lệnh) — đã tìm thấy ${d.selector}`, skipped: true };
      }
      await el.click({ timeout });
      if (d.critical) state.orderPlaced = true;
      return { message: d.selector! };
    }

    case "fill": {
      const raw = d.value ?? "";
      const value = renderTemplate(raw, vars);
      if (value.includes("{{")) throw new Error(`Biến chưa có giá trị trong “${raw}”`);
      const el = loc();
      if ((await waitOrSkip(page, el, "visible", timeout, skipSel)) === "skip") return skipped();
      await el.fill(value, { timeout });
      const shown = /\{\{\s*password\s*\}\}/.test(raw) ? "••••••" : value;
      return { message: `${d.selector} = ${shown}` };
    }

    case "press":
      if (d.critical && dryRun) {
        state.orderSkipped = true;
        return { message: `Chạy thử: KHÔNG nhấn ${d.key} (thao tác đặt lệnh)`, skipped: true };
      }
      await page.keyboard.press(d.key!);
      if (d.critical) state.orderPlaced = true;
      return { message: d.key! };

    case "waitFor":
      if ((await waitOrSkip(page, loc(), d.state ?? "visible", timeout, skipSel)) === "skip") return skipped();
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
      if ((await waitOrSkip(page, el, "visible", timeout, skipSel)) === "skip") return skipped();
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
      if (state.orderNodeRan) throw new Error("Flow đặt lệnh 2 lần trong 1 phiên — mỗi lượt bot chỉ được đặt 1 lệnh");
      state.orderNodeRan = true;

      if (d.amountSelector) {
        const input = locate(page, d.amountSelector);
        await input.waitFor({ state: "visible", timeout });
        await input.fill(String(amount), { timeout });
      }
      const btnSel = direction === "UP" ? d.upSelector! : d.downSelector!;
      const btn = locate(page, btnSel);
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
          await locate(page, d.confirmSelector).click({ timeout });
        } catch (e) {
          throw new OrderUncertainError(`Đã bấm ${label} nhưng không bấm được nút xác nhận: ${(e as Error).message.split("\n")[0]}`);
        }
      }
      return { message: `Đã đặt ${label}` };
    }

    case "direction": {
      const dir = vars.direction;
      if (dir !== "UP" && dir !== "DOWN") throw new Error("Thiếu hướng {{direction}} (UP/DOWN)");
      return { message: dir === "UP" ? "▲ Nhánh TĂNG" : "▼ Nhánh GIẢM", handle: dir === "UP" ? "up" : "down" };
    }

    case "condition": {
      const ok = evalCondition(d.left!, d.op!, d.right, vars);
      return { message: `${d.left} ${d.op} ${d.op === "exists" ? "" : renderTemplate(d.right ?? "", vars)} → ${ok ? "Đúng" : "Sai"}`, handle: ok ? "true" : "false" };
    }

    case "loopStart":
      return { message: "Từ đây: lặp lại mỗi lệnh (khi bot chạy)" };

    case "screenshot":
      return { message: "Đã chụp màn hình" };
  }
}

async function highlight(page: Page, selector: string) {
  await locate(page, selector)
    .evaluate((el: HTMLElement) => {
      el.style.outline = "4px solid #f59e0b";
      el.style.outlineOffset = "2px";
    })
    .catch(() => {});
}
