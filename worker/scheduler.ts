import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { dueRun } from "@/lib/schedule";
import { getSetting, setSetting } from "@/lib/settings";
import { inWindow, STOP_REASON_LABELS, tradingDate } from "@/lib/strategy";
import { log } from "./browser-pool";
import { esc, money, notify } from "./notifier";

const TICK_MS = 30_000;
const STORAGE_DIR = process.env.STORAGE_DIR ?? "storage";

export function startScheduler(signal: AbortSignal) {
  const loop = async () => {
    while (!signal.aborted) {
      const now = new Date();
      await scheduleBots(now).catch((e) => log("scheduler", "Lỗi lịch bot:", (e as Error).message));
      await dailySummary(now).catch((e) => log("scheduler", "Lỗi tổng kết ngày:", (e as Error).message));
      await dailyCleanup(now).catch((e) => log("scheduler", "Lỗi dọn dữ liệu:", (e as Error).message));
      await new Promise((r) => setTimeout(r, TICK_MS));
    }
  };
  loop();
  log("scheduler", "Đã bật lịch chạy (kiểm tra mỗi 30 giây)");
}

/** Tạo lệnh START cho bot đến giờ chạy. Claim nguyên tử qua lastScheduledAt để không chạy trùng. */
export async function scheduleBots(now: Date) {
  const bots = await prisma.bot.findMany({
    where: { enabled: true },
    select: { id: true, name: true, cron: true, timezone: true, lastScheduledAt: true },
  });
  for (const bot of bots) {
    const due = dueRun(bot.cron, bot.timezone, now, bot.lastScheduledAt);
    if (!due) continue;
    const { count } = await prisma.bot.updateMany({
      where: { id: bot.id, OR: [{ lastScheduledAt: null }, { lastScheduledAt: { lt: due } }] },
      data: { lastScheduledAt: due },
    });
    if (count !== 1) continue; // worker khác đã xử lý mốc này
    const busy = await prisma.command.findFirst({ where: { botId: bot.id, type: "START", status: { in: ["PENDING", "PROCESSING"] } } });
    if (busy) {
      log("scheduler", `[${bot.name}] Đến giờ chạy nhưng bot đang chạy — bỏ qua`);
      continue;
    }
    await prisma.command.create({ data: { type: "START", botId: bot.id, payload: { scheduledAt: due.toISOString() } } });
    log("scheduler", `[${bot.name}] Đến giờ chạy theo lịch (${due.toISOString()}) → tạo lệnh START`);
  }
}

/** Gửi tổng kết ngày qua Telegram đúng giờ cấu hình (1 lần/ngày). */
export async function dailySummary(now: Date) {
  const tg = await getSetting("telegram");
  if (!tg.enabled || !tg.summaryTime || !tg.events.includes("DAILY_SUMMARY")) return;
  const today = tradingDate(now, tg.timezone);
  const state = await getSetting("schedulerState");
  if (state.lastSummaryDate === today) return;
  if (!inWindow(now, tg.timezone, tg.summaryTime, "23:59")) return;

  await setSetting("schedulerState", { ...state, lastSummaryDate: today });
  const runs = await prisma.botRun.findMany({
    where: { runDate: new Date(`${today}T00:00:00Z`) },
    include: { bot: { select: { name: true } }, orders: { select: { result: true } } },
    orderBy: { pnl: "desc" },
  });
  const lines = runs.map((r) => {
    const w = r.orders.filter((o) => o.result === "WIN").length;
    const l = r.orders.filter((o) => o.result === "LOSS").length;
    const reason = r.status === "RUNNING" ? "đang chạy" : r.stopReason ? STOP_REASON_LABELS[r.stopReason] : r.status;
    return `${r.dryRun ? "🧪" : "💰"} <b>${esc(r.bot.name)}</b>: ${money(Number(r.pnl))} (${r.orders.length} lệnh, ${w}T/${l}B) — ${esc(reason)}`;
  });
  const real = runs.filter((r) => !r.dryRun).reduce((s, r) => s + Number(r.pnl), 0);
  const paper = runs.filter((r) => r.dryRun).reduce((s, r) => s + Number(r.pnl), 0);
  await notify(
    "DAILY_SUMMARY",
    [
      `📊 <b>Tổng kết ngày ${today}</b>`,
      runs.length ? lines.join("\n") : "Hôm nay không có bot nào chạy.",
      "",
      `💰 Thật: <b>${money(real)}</b>   🧪 Thử: ${money(paper)}`,
    ].join("\n"),
  );
  log("scheduler", `Đã gửi tổng kết ngày ${today}`);
}

/** Mỗi ngày 1 lần: xoá ảnh chụp cũ hơn N ngày và lệnh hệ thống cũ. */
export async function dailyCleanup(now: Date) {
  const today = now.toISOString().slice(0, 10);
  const state = await getSetting("schedulerState");
  if (state.lastCleanupDate === today) return;
  await setSetting("schedulerState", { ...(await getSetting("schedulerState")), lastCleanupDate: today });

  const { retentionDays } = await getSetting("storage");
  const cutoff = now.getTime() - retentionDays * 86_400_000;
  let removed = 0;
  for (const sub of ["runs", "bots", "screenshots"]) {
    removed += await removeOlderThan(path.join(STORAGE_DIR, sub), cutoff);
  }
  const { count } = await prisma.command.deleteMany({
    where: { status: { in: ["DONE", "FAILED", "CANCELLED"] }, createdAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } },
  });
  log("scheduler", `Dọn dữ liệu: xoá ${removed} file/thư mục ảnh > ${retentionDays} ngày, ${count} lệnh hệ thống > 30 ngày`);
}

async function removeOlderThan(dir: string, cutoff: number): Promise<number> {
  let removed = 0;
  const entries = await readdir(dir).catch(() => [] as string[]);
  for (const name of entries) {
    const p = path.join(dir, name);
    const st = await stat(p).catch(() => null);
    if (st && st.mtimeMs < cutoff) {
      await rm(p, { recursive: true, force: true });
      removed++;
    }
  }
  return removed;
}
