import { decrypt } from "@/lib/crypto";
import { getSetting, type NotifyEvent, type TelegramSettings } from "@/lib/settings";
import { escapeHtml, sendTelegram } from "@/lib/telegram";
import { log } from "./browser-pool";

let cache: { at: number; value: TelegramSettings } | null = null;

async function telegramSettings() {
  if (!cache || Date.now() - cache.at > 30_000) cache = { at: Date.now(), value: await getSetting("telegram") };
  return cache.value;
}

/** Gửi thông báo nếu sự kiện được bật. Không bao giờ ném lỗi — lỗi gửi tin không được làm dừng bot. */
export async function notify(event: NotifyEvent, html: string): Promise<void> {
  try {
    const s = await telegramSettings();
    if (!s.enabled || !s.botTokenEnc || !s.chatId || !s.events.includes(event)) return;
    const r = await sendTelegram(decrypt(s.botTokenEnc), s.chatId, html);
    if (!r.ok) log("notify", `Gửi Telegram thất bại (${event}): ${r.error}`);
  } catch (e) {
    log("notify", `Lỗi thông báo (${event}):`, (e as Error).message);
  }
}

export const esc = escapeHtml;
export const money = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString("vi-VN")}`;
