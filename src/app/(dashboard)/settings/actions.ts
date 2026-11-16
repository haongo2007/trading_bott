"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";
import { decrypt, encrypt } from "@/lib/crypto";
import { getSetting, NOTIFY_EVENTS, setSetting, type NotifyEvent } from "@/lib/settings";
import { findTelegramChats, isValidBotToken, sendTelegram } from "@/lib/telegram";
import { isValidHHMM } from "@/lib/strategy";

export type SettingsState = { ok?: boolean; message?: string; errors?: Record<string, string[] | undefined> };

const telegramSchema = z.object({
  enabled: z.preprocess((v) => v === "on", z.boolean()),
  botToken: z.string().trim().max(200).optional(),
  chatId: z.string().trim().max(64).regex(/^-?\d*$|^@[\w]+$/, "Chat ID là số (VD 123456789 hoặc -100…) hoặc @tên_kênh").optional(),
  events: z.array(z.enum(Object.keys(NOTIFY_EVENTS) as [NotifyEvent, ...NotifyEvent[]])).default([]),
  summaryTime: z.string().refine((v) => v === "" || isValidHHMM(v), "Dạng HH:MM").optional(),
  timezone: z.string().min(1).max(64),
});

export async function saveTelegramSettings(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireUser(["ADMIN"]);
  const parsed = telegramSchema.safeParse({ ...Object.fromEntries(formData), events: formData.getAll("events") });
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const d = parsed.data;
  const current = await getSetting("telegram");

  if (d.botToken && !isValidBotToken(d.botToken)) return { errors: { botToken: ["Token không đúng định dạng (VD 123456789:AA…)"] } };
  const botTokenEnc = d.botToken ? encrypt(d.botToken) : current.botTokenEnc;
  if (d.enabled && (!botTokenEnc || !d.chatId)) return { message: "Cần bot token và chat ID để bật thông báo" };

  await setSetting("telegram", {
    enabled: d.enabled,
    botTokenEnc,
    chatId: d.chatId || undefined,
    events: d.events,
    summaryTime: d.summaryTime || undefined,
    timezone: d.timezone,
  });
  await prisma.auditLog.create({
    data: { userId: user.id, action: "UPDATE", entity: "Settings", entityId: "telegram", diff: { enabled: d.enabled, events: d.events, tokenChanged: !!d.botToken } },
  });
  revalidatePath("/settings");
  return { ok: true, message: "Đã lưu cài đặt Telegram" };
}

/** Token mới nhập (chưa lưu) hoặc token đã lưu. */
async function resolveToken(token?: string) {
  if (token?.trim()) return token.trim();
  const s = await getSetting("telegram");
  return s.botTokenEnc ? decrypt(s.botTokenEnc) : null;
}

export async function sendTelegramTest(token: string, chatId: string): Promise<SettingsState> {
  await requireUser(["ADMIN"]);
  const t = await resolveToken(token);
  if (!t) return { ok: false, message: "Chưa có bot token" };
  if (!chatId.trim()) return { ok: false, message: "Chưa có chat ID" };
  const r = await sendTelegram(t, chatId.trim(), "✅ <b>Bot Trading</b>: kết nối Telegram thành công. Bạn sẽ nhận thông báo tại đây.");
  return r.ok ? { ok: true, message: "Đã gửi tin nhắn thử — kiểm tra Telegram" } : { ok: false, message: `Gửi thất bại: ${r.error}` };
}

export async function lookupTelegramChats(token: string) {
  await requireUser(["ADMIN"]);
  const t = await resolveToken(token);
  if (!t) return { ok: false, chats: [], error: "Chưa có bot token" };
  return findTelegramChats(t);
}

export async function saveStorageSettings(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireUser(["ADMIN"]);
  const days = Number(formData.get("retentionDays"));
  if (!Number.isInteger(days) || days < 1 || days > 365) return { errors: { retentionDays: ["Từ 1 đến 365 ngày"] } };
  await setSetting("storage", { retentionDays: days });
  await prisma.auditLog.create({ data: { userId: user.id, action: "UPDATE", entity: "Settings", entityId: "storage", diff: { retentionDays: days } } });
  revalidatePath("/settings");
  return { ok: true, message: "Đã lưu" };
}
