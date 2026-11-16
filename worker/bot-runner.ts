import type { Page } from "playwright";
import type { Bot, BotRun, Command, Flow, TradingAccount } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { flowCanPlaceOrder } from "@/lib/flow";
import {
  checkStop, clampStake, computeLimits, inWindow, lossStreak, nextDirection, nextStake, resultFromPnl, settlePnl,
  STOP_REASON_LABELS, tradingDate,
  type DirectionConfig, type DirectionMode, type OrderOutcome, type StakeConfig, type StakeMode, type StopReasonKind,
} from "@/lib/strategy";
import { log, newAccountContext, tryLockAccount, unlockAccount } from "./browser-pool";
import { ensureLoggedIn, LOGIN_VIA_LABELS, readBalance, saveStorageState } from "./login";
import { accountVars, loadGraph, makeShooter, publicVars, runGraph, type FlowVars } from "./flow-runner";
import { describeAiError, predictDirection, type AiPredictionResult } from "./ai-direction";
import { esc, money, notify } from "./notifier";

/** Lý do dừng do quản lý rủi ro → hôm nay không chạy lại nữa. */
const FINAL_REASONS: StopReasonKind[] = ["TAKE_PROFIT", "STOP_LOSS", "MAX_CONSECUTIVE_LOSS", "MAX_ORDERS", "BUDGET_EXHAUSTED"];
const MAX_AI_SKIPS = 30;

type BotFull = Bot & { account: TradingAccount; flow: Flow | null };

const num = (d: unknown) => Number(d ?? 0);

export async function runBot(cmd: Command): Promise<{ ok: boolean; message: string; runId?: string }> {
  const bot = (await prisma.bot.findUnique({ where: { id: cmd.botId! }, include: { account: true, flow: true } })) as BotFull | null;
  if (!bot) return { ok: false, message: "Không tìm thấy bot" };
  if (!bot.flow) return { ok: false, message: "Bot chưa chọn flow đặt lệnh" };
  if (bot.account.status === "DISABLED") return { ok: false, message: "Tài khoản sàn đang tạm khoá" };
  if (!bot.account.balanceSelector) return { ok: false, message: "Tài khoản sàn chưa cấu hình selector số dư — bot cần đọc số dư để quản lý rủi ro" };
  const graph = loadGraph(bot.flow.graph);
  if (!flowCanPlaceOrder(graph.nodes)) {
    return { ok: false, message: "Flow chưa có thao tác đặt lệnh (khối “Đặt lệnh” hoặc nút đánh dấu “Thao tác đặt lệnh”)" };
  }

  const now = new Date();
  if (!inWindow(now, bot.timezone, bot.windowStart, bot.windowEnd)) {
    return { ok: false, message: `Ngoài khung giờ chạy (${bot.windowStart ?? "--"} → ${bot.windowEnd ?? "--"})` };
  }
  const runDate = new Date(`${tradingDate(now, bot.timezone)}T00:00:00Z`);
  const existing = await prisma.botRun.findUnique({ where: { botId_runDate_dryRun: { botId: bot.id, runDate, dryRun: bot.dryRun } } });
  if (existing?.status === "RUNNING") return { ok: false, message: "Bot đang chạy" };
  if (existing?.stopReason && FINAL_REASONS.includes(existing.stopReason)) {
    return { ok: false, message: `Hôm nay bot đã dừng: ${STOP_REASON_LABELS[existing.stopReason]}. Sẽ chạy lại vào ngày giao dịch mới.` };
  }

  const owner = `bot:${bot.id}`;
  if (!tryLockAccount(bot.accountId, owner)) return { ok: false, message: "Tài khoản sàn đang được dùng ở phiên khác" };

  // Bỏ các lệnh dừng cũ gửi trước lệnh START này
  await prisma.command.updateMany({
    where: { botId: bot.id, type: { in: ["STOP", "KILL"] }, status: "PENDING", createdAt: { lt: cmd.createdAt } },
    data: { status: "DONE", result: "Bỏ qua (gửi trước khi bot khởi động)" },
  });

  let run: BotRun | null = existing;
  const context = await newAccountContext(bot.account, { headlessRun: true }).catch((e) => {
    unlockAccount(bot.accountId, owner);
    throw e;
  });
  const page = await context.newPage();
  let stopReason: StopReasonKind = "ERROR";
  let errorMsg: string | null = null;

  const logRun = async (message: string, level: "INFO" | "WARN" | "ERROR" = "INFO", screenshot?: string) => {
    log("bot", `[${bot.name}] ${message}`);
    if (run) await prisma.runLog.create({ data: { runId: run.id, level, message, screenshot } });
  };

  try {
    const via = await ensureLoggedIn(page, bot.account);
    await saveStorageState(context, bot.accountId);
    const startReal = (await readBalance(page, bot.account)).balance;
    if (startReal == null) throw new Error("Không đọc được số dư (kiểm tra selector số dư)");

    if (!run) {
      const limits = computeLimits(
        { takeProfitType: bot.takeProfitType, takeProfitValue: num(bot.takeProfitValue), stopLossType: bot.stopLossType, stopLossValue: num(bot.stopLossValue) },
        startReal,
      );
      run = await prisma.botRun.create({
        data: {
          botId: bot.id, runDate, dryRun: bot.dryRun, status: "RUNNING", startBalance: startReal, endBalance: startReal,
          targetAmount: limits.target, lossLimit: limits.lossLimit, startedAt: new Date(),
        },
      });
      await logRun(`Bắt đầu phiên ${bot.dryRun ? "CHẠY THỬ (giả lập)" : "THẬT"} — đăng nhập ${LOGIN_VIA_LABELS[via]}, số dư ${fmt(startReal)}. Mục tiêu ${limits.target > 0 ? `+${fmt(limits.target)}` : "tắt"}, cắt lỗ ${limits.lossLimit > 0 ? `-${fmt(limits.lossLimit)}` : "tắt"}`);
    } else {
      run = await prisma.botRun.update({ where: { id: run.id }, data: { status: "RUNNING", stopReason: null, error: null, endedAt: null } });
      await logRun(`Tiếp tục phiên hôm nay — số dư hiện tại ${fmt(startReal)} (mục tiêu/cắt lỗ giữ theo số dư đầu ngày ${fmt(num(run.startBalance))})`);
    }
    await prisma.command.update({ where: { id: cmd.id }, data: { result: JSON.stringify({ runId: run.id }) } });
    await notify(
      "BOT_START",
      `▶️ <b>${esc(bot.name)}</b> bắt đầu ${bot.dryRun ? "chạy thử 🧪" : "chạy THẬT 💰"}\nSố dư: ${fmt(startReal)} · Lãi/lỗ ngày hiện tại: ${money(num(run.pnl))}`,
    );

    // Phần chuẩn bị (trên khối “Mỗi lệnh bắt đầu từ đây”): chạy 1 lần, trình duyệt giữ nguyên cho các lệnh sau
    let setupVars: FlowVars = {};
    if (graph.nodes.some((n) => n.type === "loopStart")) {
      const vars: FlowVars = { ...accountVars(bot.account) };
      const r = await runGraph(page, graph, vars, {
        dryRun: bot.dryRun,
        isCancelled: async () => false,
        shoot: await makeShooter(page, ["bots", run.id]),
        segment: "setup",
      });
      if (r.orderPlaced || r.orderSkipped) {
        throw new Error("Phần chuẩn bị (trước khối “Mỗi lệnh bắt đầu từ đây”) có thao tác đặt lệnh — hãy chuyển nó xuống dưới khối mốc");
      }
      if (!r.ok) throw new Error(`Phần chuẩn bị lỗi: ${r.error}`);
      setupVars = publicVars(vars);
      await logRun(`Đã chạy phần chuẩn bị (${r.logs.length} bước) — từ giờ mỗi lệnh chỉ chạy phần dưới khối mốc`);
    }

    stopReason = await tradingLoop(bot, run, page, graph, logRun, setupVars);
  } catch (e) {
    stopReason = "ERROR";
    errorMsg = (e as Error).message.split("\n")[0];
    await logRun(`Lỗi: ${errorMsg}`, "ERROR").catch(() => {});
  } finally {
    const balance = run ? await finalBalance(page, bot, run) : null;
    await context.close().catch(() => {});
    unlockAccount(bot.accountId, owner);
    if (run) {
      const status = stopReason === "ERROR" ? "FAILED" : FINAL_REASONS.includes(stopReason) || stopReason === "WINDOW_ENDED" ? "COMPLETED" : "STOPPED";
      run = await prisma.botRun.update({
        where: { id: run.id },
        data: { status, stopReason, error: errorMsg, endedAt: new Date(), ...(balance != null && { endBalance: balance }) },
      });
      await logRun(`Kết thúc: ${STOP_REASON_LABELS[stopReason]}${errorMsg ? ` — ${errorMsg}` : ""}. Lãi/lỗ ngày: ${signed(num(run.pnl))}`, stopReason === "ERROR" ? "ERROR" : "INFO");
      const orders = await prisma.order.count({ where: { runId: run.id } });
      const icon = stopReason === "ERROR" ? "❌" : stopReason === "TAKE_PROFIT" ? "🎯" : stopReason === "STOP_LOSS" ? "🛑" : "⏹";
      await notify(
        stopReason === "ERROR" ? "BOT_ERROR" : "BOT_STOP",
        `${icon} <b>${esc(bot.name)}</b>${bot.dryRun ? " (thử)" : ""} dừng: ${esc(STOP_REASON_LABELS[stopReason])}${errorMsg ? `\n${esc(errorMsg)}` : ""}\nLãi/lỗ ngày: <b>${money(num(run.pnl))}</b> · ${orders} lệnh`,
      );
    }
  }
  return {
    ok: stopReason !== "ERROR",
    message: errorMsg ?? STOP_REASON_LABELS[stopReason],
    runId: run?.id,
  };
}

async function tradingLoop(
  bot: BotFull,
  run: BotRun,
  page: Page,
  graph: ReturnType<typeof loadGraph>,
  logRun: (m: string, level?: "INFO" | "WARN" | "ERROR", shot?: string) => Promise<void>,
  setupVars: FlowVars = {},
): Promise<StopReasonKind> {
  const stakeCfg = (bot.stakeConfig ?? {}) as StakeConfig;
  const dirCfg = (bot.directionConfig ?? {}) as DirectionConfig;
  const startBalance = num(run.startBalance);
  const limits = {
    target: num(run.targetAmount),
    lossLimit: num(run.lossLimit),
    maxConsecutiveLoss: bot.maxConsecutiveLoss,
    maxOrdersPerDay: bot.maxOrdersPerDay,
  };
  const shoot = await makeShooter(page, ["bots", run.id]);

  // Khôi phục trạng thái nếu tiếp tục phiên trong ngày
  const prev = await prisma.order.findMany({ where: { runId: run.id }, orderBy: { seq: "asc" } });
  const history: OrderOutcome[] = prev.map((o) => ({ direction: o.direction, amount: num(o.amount), result: o.result }));
  let seq = prev.at(-1)?.seq ?? 0;
  let staked = prev.reduce((s, o) => s + num(o.amount), 0);
  let pnl = num(run.pnl);
  let lastVars: FlowVars = { ...setupVars };
  let aiSkips = 0;

  const signal = async (): Promise<"STOP" | "KILL" | null> => {
    const c = await prisma.command.findFirst({
      where: { botId: bot.id, type: { in: ["STOP", "KILL"] }, status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });
    if (!c) return null;
    await prisma.command.update({ where: { id: c.id }, data: { status: "DONE", result: "Bot đã nhận lệnh dừng" } });
    return c.type as "STOP" | "KILL";
  };
  let pendingStop: "STOP" | "KILL" | null = null;
  const killRequested = async () => {
    pendingStop ??= await signal();
    return pendingStop === "KILL";
  };
  /** Ngủ có thể bị ngắt bởi STOP/KILL. */
  const sleep = async (sec: number) => {
    const until = Date.now() + sec * 1000;
    while (Date.now() < until) {
      pendingStop ??= await signal();
      if (pendingStop) return;
      await page.waitForTimeout(Math.min(1000, until - Date.now()));
    }
  };

  for (;;) {
    pendingStop ??= await signal();
    if (pendingStop) return pendingStop === "KILL" ? "KILL_SWITCH" : "MANUAL";
    if (!inWindow(new Date(), bot.timezone, bot.windowStart, bot.windowEnd)) return "WINDOW_ENDED";

    const risk = checkStop({ pnl, consecutiveLosses: lossStreak(history), orderCount: history.length }, limits);
    if (risk) return risk;

    // Số dư trước lệnh: thật → đọc từ trang; thử → số dư ảo
    let balanceBefore = startBalance + pnl;
    if (!bot.dryRun) {
      const b = (await readBalance(page, bot.account)).balance;
      if (b == null) throw new Error("Không đọc được số dư trước khi đặt lệnh");
      balanceBefore = b;
      pnl = b - startBalance;
      const risk2 = checkStop({ pnl, consecutiveLosses: lossStreak(history), orderCount: history.length }, limits);
      if (risk2) return risk2;
    }

    const minStake = stakeCfg.roundTo && stakeCfg.roundTo > 0 ? stakeCfg.roundTo : 1000;
    const amount = clampStake(nextStake(bot.stakeMode as StakeMode, stakeCfg, history, balanceBefore), {
      maxStake: num(bot.maxStake),
      balance: balanceBefore,
      budgetLeft: num(bot.dailyBudget) - staked,
      lossRoom: limits.lossLimit > 0 ? limits.lossLimit + pnl : null,
      minStake,
    });
    if (amount == null) return "BUDGET_EXHAUSTED";

    // Hướng lệnh
    let direction = nextDirection(bot.directionMode as DirectionMode, dirCfg, history);
    let prediction: AiPredictionResult | null = null;
    if (direction === "AI") {
      try {
        prediction = await predictDirection(dirCfg.ai ?? {}, history, { vars: lastVars, balance: balanceBefore });
      } catch (e) {
        throw new Error(`AI lỗi: ${describeAiError(e)} — dừng để an toàn (không đặt lệnh ngẫu nhiên)`);
      }
      const min = dirCfg.ai?.minConfidence ?? 0.6;
      if (prediction.confidence < min) {
        aiSkips++;
        await logRun(`AI chọn ${prediction.direction} nhưng độ tin cậy ${(prediction.confidence * 100).toFixed(0)}% < ${(min * 100).toFixed(0)}% → bỏ qua phiên. ${prediction.reasoning}`, "WARN");
        if (aiSkips >= MAX_AI_SKIPS) throw new Error(`AI bỏ qua ${MAX_AI_SKIPS} phiên liên tiếp — dừng bot`);
        await sleep(Math.max(bot.roundDelaySec, 5));
        continue;
      }
      aiSkips = 0;
      direction = prediction.direction;
    }

    seq++;
    const order = await prisma.order.create({
      data: { runId: run.id, seq, direction, amount, balanceBefore, simulated: bot.dryRun, result: "PENDING" },
    });
    if (prediction) {
      await prisma.aiPrediction.create({
        data: { orderId: order.id, model: prediction.model, direction: prediction.direction, confidence: prediction.confidence, reasoning: prediction.reasoning, latencyMs: prediction.latencyMs },
      });
    }

    const vars: FlowVars = { ...accountVars(bot.account), ...lastVars, amount, direction };
    const r = await runGraph(page, graph, vars, { dryRun: bot.dryRun, isCancelled: killRequested, shoot, seqOffset: seq * 100, segment: "order" });
    lastVars = publicVars(vars);
    const shot = r.logs.findLast((l) => l.screenshot)?.screenshot;

    if (!r.ok) {
      await prisma.order.update({
        where: { id: order.id },
        data: { result: "UNKNOWN", error: r.error, screenshot: shot, settledAt: new Date() },
      });
      staked += r.orderPlaced ? amount : 0;
      if (r.cancelled) {
        await logRun(`Lệnh #${seq} bị ngắt bởi dừng khẩn cấp${r.orderPlaced ? " SAU khi đã bấm đặt lệnh — kiểm tra lại trên sàn" : " (chưa đặt lệnh)"}`, "WARN", shot);
        return "KILL_SWITCH";
      }
      // Không thử lại mù quáng: lệnh có thể đã được đặt
      if (r.orderPlaced) {
        await notify("ORDER_UNCERTAIN", `⚠️ <b>${esc(bot.name)}</b>: lệnh #${seq} ${direction} ${fmt(amount)} đã bấm đặt nhưng flow lỗi sau đó — hãy kiểm tra trên sàn.\n${esc(r.error ?? "")}`);
      }
      throw new Error(`Lệnh #${seq}: flow lỗi${r.orderPlaced ? " SAU khi đã bấm đặt lệnh (trạng thái lệnh không chắc chắn — kiểm tra trên sàn)" : ""} — ${r.error}`);
    }
    if (!bot.dryRun && !r.orderPlaced) {
      await prisma.order.update({ where: { id: order.id }, data: { result: "UNKNOWN", error: "Flow không chạy tới khối Đặt lệnh", settledAt: new Date() } });
      throw new Error("Flow chạy xong nhưng không đi qua khối “Đặt lệnh” — kiểm tra các nhánh Điều kiện");
    }
    staked += amount;

    // Kết quả
    let orderPnl: number;
    let result: OrderOutcome["result"];
    let balanceAfter: number;
    if (bot.dryRun) {
      // Giả lập: thắng/thua ngẫu nhiên 50/50 với tỉ lệ trả thưởng cấu hình (không có lợi thế nào)
      result = Math.random() < 0.5 ? "WIN" : "LOSS";
      orderPnl = settlePnl(amount, result, num(bot.payoutPercent));
      balanceAfter = balanceBefore + orderPnl;
    } else {
      if (bot.settleDelaySec > 0) await sleep(bot.settleDelaySec);
      const b = (await readBalance(page, bot.account)).balance;
      if (b == null) {
        await prisma.order.update({ where: { id: order.id }, data: { result: "UNKNOWN", error: "Không đọc được số dư sau lệnh", screenshot: shot, settledAt: new Date() } });
        await notify("ORDER_UNCERTAIN", `⚠️ <b>${esc(bot.name)}</b>: lệnh #${seq} ${direction} ${fmt(amount)} đã đặt nhưng không đọc được số dư sau đó — hãy kiểm tra trên sàn.`);
        throw new Error(`Lệnh #${seq}: không đọc được số dư sau khi đặt — dừng để an toàn`);
      }
      balanceAfter = b;
      orderPnl = b - balanceBefore;
      result = resultFromPnl(orderPnl);
    }
    pnl = balanceAfter - startBalance;
    history.push({ direction, amount, result });

    await prisma.order.update({
      where: { id: order.id },
      data: { result, pnl: orderPnl, balanceAfter, screenshot: shot, settledAt: new Date() },
    });
    await prisma.botRun.update({ where: { id: run.id }, data: { pnl, endBalance: balanceAfter } });
    const resText = result === "WIN" ? "THẮNG" : result === "LOSS" ? "THUA" : "HOÀ";
    await logRun(
      `Lệnh #${seq}${bot.dryRun ? " (giả lập)" : ""}: ${direction === "UP" ? "▲ TĂNG" : "▼ GIẢM"} ${fmt(amount)}${prediction ? ` [AI ${(prediction.confidence * 100).toFixed(0)}%]` : ""} → ${resText} ${signed(orderPnl)} | Lãi/lỗ ngày ${signed(pnl)}`,
      "INFO",
      shot,
    );

    await sleep(bot.roundDelaySec);
  }
}

async function finalBalance(page: Page, bot: BotFull, run: BotRun): Promise<number | null> {
  if (bot.dryRun) {
    const r = await prisma.botRun.findUnique({ where: { id: run.id }, select: { startBalance: true, pnl: true } });
    return r ? num(r.startBalance) + num(r.pnl) : null;
  }
  return (await readBalance(page, bot.account).catch(() => ({ balance: null }))).balance;
}

/** Worker khởi động lại: phiên đang chạy dở coi như lỗi, lệnh chờ kết quả → không rõ. */
export async function recoverStaleRuns() {
  const stale = await prisma.botRun.findMany({ where: { status: "RUNNING" }, select: { id: true } });
  if (!stale.length) return;
  const ids = stale.map((r) => r.id);
  await prisma.order.updateMany({ where: { runId: { in: ids }, result: "PENDING" }, data: { result: "UNKNOWN", error: "Worker khởi động lại khi lệnh đang chờ kết quả" } });
  await prisma.botRun.updateMany({ where: { id: { in: ids } }, data: { status: "FAILED", stopReason: "ERROR", error: "Worker khởi động lại khi bot đang chạy", endedAt: new Date() } });
  await prisma.command.updateMany({ where: { type: { in: ["STOP", "KILL"] }, status: "PENDING" }, data: { status: "DONE", result: "Bỏ qua (worker khởi động lại)" } });
  log("bot", `Đánh dấu ${ids.length} phiên bot dở dang là FAILED`);
}

const fmt = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}`;
const signed = (n: number) => `${n >= 0 ? "+" : ""}${fmt(n)}`;
