"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";
import { tradingDate } from "@/lib/strategy";
import { botFormSchema, toBotData, type BotFormState } from "@/lib/validation/bot";

const WRITE_ROLES = ["ADMIN", "OPERATOR"] as const;

function parse(formData: FormData) {
  // checkbox nhiều giá trị (ngày trong tuần) cần getAll
  return botFormSchema.safeParse({ ...Object.fromEntries(formData), schedule_days: formData.getAll("schedule_days") });
}

async function ensureRefs(accountId: string, flowId: string): Promise<string | null> {
  const [acc, flow] = await Promise.all([
    prisma.tradingAccount.findUnique({ where: { id: accountId }, select: { balanceSelector: true } }),
    prisma.flow.findUnique({ where: { id: flowId }, select: { graph: true } }),
  ]);
  if (!acc) return "Tài khoản sàn không tồn tại";
  if (!acc.balanceSelector) return "Tài khoản sàn chưa có selector số dư — bot cần đọc số dư để quản lý rủi ro";
  if (!flow) return "Flow không tồn tại";
  const nodes = (flow.graph as { nodes?: { type: string }[] }).nodes ?? [];
  if (!nodes.some((n) => n.type === "order")) return "Flow chưa có khối “Đặt lệnh” — mở flow và thêm khối này";
  return null;
}

export async function createBot(_prev: BotFormState, formData: FormData): Promise<BotFormState> {
  const user = await requireUser([...WRITE_ROLES]);
  const parsed = parse(formData);
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const refError = await ensureRefs(parsed.data.accountId, parsed.data.flowId);
  if (refError) return { message: refError };

  // Lịch chỉ tính các mốc từ bây giờ trở đi
  const bot = await prisma.bot.create({ data: { ...toBotData(parsed.data), lastScheduledAt: new Date() } });
  await prisma.auditLog.create({ data: { userId: user.id, action: "CREATE", entity: "Bot", entityId: bot.id, diff: toBotData(parsed.data) } });
  revalidatePath("/bots");
  redirect(`/bots/${bot.id}`);
}

export async function updateBot(id: string, _prev: BotFormState, formData: FormData): Promise<BotFormState> {
  const user = await requireUser([...WRITE_ROLES]);
  const parsed = parse(formData);
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const refError = await ensureRefs(parsed.data.accountId, parsed.data.flowId);
  if (refError) return { message: refError };
  const running = await prisma.botRun.count({ where: { botId: id, status: "RUNNING" } });
  if (running) return { message: "Bot đang chạy — dừng bot trước khi đổi cài đặt" };

  const data = toBotData(parsed.data);
  const prev = await prisma.bot.findUnique({ where: { id }, select: { enabled: true, cron: true } });
  const scheduleChanged = data.enabled && (!prev?.enabled || (data.cron !== undefined && prev.cron !== data.cron));
  await prisma.bot.update({ where: { id }, data: { ...data, ...(scheduleChanged && { lastScheduledAt: new Date() }) } });
  await prisma.auditLog.create({ data: { userId: user.id, action: "UPDATE", entity: "Bot", entityId: id, diff: data } });
  revalidatePath("/bots");
  redirect(`/bots/${id}`);
}

export async function deleteBot(id: string) {
  const user = await requireUser(["ADMIN"]);
  const running = await prisma.botRun.count({ where: { botId: id, status: "RUNNING" } });
  if (running) return { ok: false, error: "Bot đang chạy — dừng trước khi xoá" };
  await prisma.bot.delete({ where: { id } });
  await prisma.auditLog.create({ data: { userId: user.id, action: "DELETE", entity: "Bot", entityId: id } });
  revalidatePath("/bots");
  redirect("/bots");
}

export async function startBot(botId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser([...WRITE_ROLES]);
  const bot = await prisma.bot.findUnique({ where: { id: botId }, select: { id: true, dryRun: true } });
  if (!bot) return { ok: false, error: "Không tìm thấy bot" };
  const busy = await prisma.command.findFirst({ where: { botId, type: "START", status: { in: ["PENDING", "PROCESSING"] } } });
  if (busy) return { ok: false, error: "Bot đang chạy hoặc đang chờ worker khởi động" };
  await prisma.command.create({ data: { type: "START", botId } });
  await prisma.auditLog.create({ data: { userId: user.id, action: bot.dryRun ? "START_BOT_DRY" : "START_BOT_LIVE", entity: "Bot", entityId: botId } });
  revalidatePath(`/bots/${botId}`);
  return { ok: true };
}

export async function stopBot(botId: string, kill = false): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser([...WRITE_ROLES]);
  // Huỷ lệnh START chưa được worker nhận
  await prisma.command.updateMany({ where: { botId, type: "START", status: "PENDING" }, data: { status: "CANCELLED" } });
  const active = await prisma.command.findFirst({ where: { botId, type: "START", status: "PROCESSING" } });
  if (active) await prisma.command.create({ data: { type: kill ? "KILL" : "STOP", botId } });
  await prisma.auditLog.create({ data: { userId: user.id, action: kill ? "KILL_BOT" : "STOP_BOT", entity: "Bot", entityId: botId } });
  revalidatePath(`/bots/${botId}`);
  return { ok: true };
}

/** Dừng khẩn cấp TẤT CẢ bot: huỷ lệnh chờ + gửi KILL cho bot đang chạy. */
export async function killAllBots(): Promise<{ stopped: number }> {
  const user = await requireUser([...WRITE_ROLES]);
  await prisma.command.updateMany({ where: { type: "START", status: "PENDING" }, data: { status: "CANCELLED" } });
  const active = await prisma.command.findMany({ where: { type: "START", status: "PROCESSING" }, select: { botId: true } });
  const botIds = [...new Set(active.map((c) => c.botId).filter(Boolean) as string[])];
  if (botIds.length) await prisma.command.createMany({ data: botIds.map((botId) => ({ type: "KILL" as const, botId })) });
  await prisma.auditLog.create({ data: { userId: user.id, action: "KILL_ALL", entity: "Bot", diff: { botIds } } });
  revalidatePath("/bots");
  return { stopped: botIds.length };
}

export type BotLiveView = Awaited<ReturnType<typeof getBotLive>>;

export async function getBotLive(botId: string) {
  await requireUser();
  const bot = await prisma.bot.findUnique({ where: { id: botId }, select: { dryRun: true, timezone: true } });
  if (!bot) return null;
  const runDate = new Date(`${tradingDate(new Date(), bot.timezone)}T00:00:00Z`);
  const [run, lastStart] = await Promise.all([
    prisma.botRun.findUnique({
      where: { botId_runDate_dryRun: { botId, runDate, dryRun: bot.dryRun } },
      include: {
        orders: { orderBy: { seq: "desc" }, take: 100, include: { prediction: true } },
        logs: { orderBy: { createdAt: "desc" }, take: 80 },
      },
    }),
    prisma.command.findFirst({ where: { botId, type: "START" }, orderBy: { createdAt: "desc" } }),
  ]);
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  let lastStartResult: { ok?: boolean; message?: string } | null = null;
  try {
    lastStartResult = lastStart?.result ? JSON.parse(lastStart.result) : null;
  } catch {
    lastStartResult = null;
  }
  return {
    dryRun: bot.dryRun,
    command: lastStart
      ? {
          status: lastStart.status,
          createdAt: lastStart.createdAt.toISOString(),
          ageSec: Math.round((Date.now() - lastStart.createdAt.getTime()) / 1000),
          message: lastStartResult?.message ?? null,
        }
      : null,
    run: run && {
      id: run.id,
      status: run.status,
      stopReason: run.stopReason,
      error: run.error,
      startBalance: n(run.startBalance),
      endBalance: n(run.endBalance),
      targetAmount: n(run.targetAmount),
      lossLimit: n(run.lossLimit),
      pnl: n(run.pnl) ?? 0,
      startedAt: run.startedAt?.toISOString() ?? null,
      endedAt: run.endedAt?.toISOString() ?? null,
      orders: run.orders.map((o) => ({
        id: o.id, seq: o.seq, direction: o.direction, amount: Number(o.amount), result: o.result, pnl: n(o.pnl),
        balanceAfter: n(o.balanceAfter), simulated: o.simulated, error: o.error, screenshot: o.screenshot,
        placedAt: o.placedAt.toISOString(),
        ai: o.prediction ? { confidence: o.prediction.confidence, reasoning: o.prediction.reasoning, model: o.prediction.model } : null,
      })),
      logs: run.logs.map((l) => ({ id: l.id, level: l.level, message: l.message, createdAt: l.createdAt.toISOString() })),
    },
  };
}
