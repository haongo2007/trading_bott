"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";
import { signBrowserToken } from "@/lib/worker-token";
import { ASSIGNABLE_FIELDS, type AssignableField } from "@/lib/live-protocol";

const WRITE_ROLES = ["ADMIN", "OPERATOR"] as const;

export type CommandView = {
  status: "PENDING" | "PROCESSING" | "DONE" | "FAILED" | "CANCELLED";
  ageSec: number;
  result: { ok: boolean; error?: string; via?: string; balanceText?: string | null; screenshot?: string } | null;
};

export async function requestTestLogin(accountId: string): Promise<{ commandId?: string; error?: string }> {
  await requireUser([...WRITE_ROLES]);
  const account = await prisma.tradingAccount.findUnique({ where: { id: accountId }, select: { status: true } });
  if (!account) return { error: "Không tìm thấy tài khoản" };
  if (account.status === "DISABLED") return { error: "Tài khoản đang tạm khoá" };

  const pending = await prisma.command.findFirst({
    where: { accountId, type: "TEST_LOGIN", status: { in: ["PENDING", "PROCESSING"] } },
  });
  if (pending) return { commandId: pending.id };

  const cmd = await prisma.command.create({ data: { type: "TEST_LOGIN", accountId } });
  return { commandId: cmd.id };
}

export async function getCommandStatus(commandId: string): Promise<CommandView | null> {
  await requireUser();
  const cmd = await prisma.command.findUnique({ where: { id: commandId } });
  if (!cmd) return null;
  let result: CommandView["result"] = null;
  try {
    result = cmd.result ? JSON.parse(cmd.result) : null;
  } catch {
    result = { ok: false, error: cmd.result ?? undefined };
  }
  if (cmd.status === "DONE" || cmd.status === "FAILED") revalidatePath(`/accounts/${cmd.accountId}`);
  return { status: cmd.status, ageSec: Math.round((Date.now() - cmd.createdAt.getTime()) / 1000), result };
}

export async function createLiveBrowserToken(accountId: string): Promise<{ wsUrl: string; token: string }> {
  const user = await requireUser([...WRITE_ROLES]);
  const exists = await prisma.tradingAccount.count({ where: { id: accountId } });
  if (!exists) throw new Error("Không tìm thấy tài khoản");
  await prisma.auditLog.create({
    data: { userId: user.id, action: "OPEN_LIVE_BROWSER", entity: "TradingAccount", entityId: accountId },
  });
  return {
    wsUrl: process.env.WORKER_PUBLIC_WS_URL ?? "ws://localhost:3001/live",
    token: signBrowserToken({ accountId, userId: user.id }, 120),
  };
}

export async function assignSelector(
  accountId: string,
  field: AssignableField,
  selector: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser([...WRITE_ROLES]);
  if (!(field in ASSIGNABLE_FIELDS)) return { ok: false, error: "Trường không hợp lệ" };
  const value = selector.trim();
  if (!value || value.length > 1024) return { ok: false, error: "Selector không hợp lệ" };

  await prisma.tradingAccount.update({ where: { id: accountId }, data: { [field]: value } });
  await prisma.auditLog.create({
    data: { userId: user.id, action: "ASSIGN_SELECTOR", entity: "TradingAccount", entityId: accountId, diff: { field, value } },
  });
  revalidatePath(`/accounts/${accountId}`);
  return { ok: true };
}

export async function getWorkerHealth(): Promise<{ online: boolean; liveSessions?: number; aiConfigured?: boolean }> {
  await requireUser();
  const url = process.env.WORKER_HTTP_URL ?? "http://127.0.0.1:3001";
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500), cache: "no-store" });
    const json = await res.json();
    return { online: !!json.ok, liveSessions: json.liveSessions, aiConfigured: json.aiConfigured };
  } catch (e) {
    console.warn(`[worker-health] Không gọi được ${url}/health:`, (e as Error).message);
    return { online: false };
  }
}
