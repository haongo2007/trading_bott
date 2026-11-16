// Gửi tin nhắn qua Telegram Bot API. Dùng chung cho dashboard (gửi thử) và worker (thông báo).
// TELEGRAM_API_BASE cho phép trỏ tới server giả lập khi test.

const apiBase = () => process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org";

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{20,}$/;
export const isValidBotToken = (t: string) => TOKEN_RE.test(t.trim());

export async function sendTelegram(token: string, chatId: string, html: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${apiBase()}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: html.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!json.ok) return { ok: false, error: json.description ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Danh sách chat đã nhắn cho bot gần đây — giúp người dùng lấy chat ID. */
export async function findTelegramChats(token: string): Promise<{ ok: boolean; chats: { id: string; name: string }[]; error?: string }> {
  try {
    const res = await fetch(`${apiBase()}/bot${token}/getUpdates`, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    const json = (await res.json()) as {
      ok?: boolean;
      description?: string;
      result?: { message?: { chat?: { id: number; title?: string; username?: string; first_name?: string } } }[];
    };
    if (!json.ok) return { ok: false, chats: [], error: json.description ?? `HTTP ${res.status}` };
    const map = new Map<string, string>();
    for (const u of json.result ?? []) {
      const c = u.message?.chat;
      if (c) map.set(String(c.id), c.title ?? (c.username ? `@${c.username}` : (c.first_name ?? String(c.id))));
    }
    return { ok: true, chats: [...map].map(([id, name]) => ({ id, name })) };
  } catch (e) {
    return { ok: false, chats: [], error: (e as Error).message };
  }
}
