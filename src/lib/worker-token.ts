import { createHmac, timingSafeEqual } from "node:crypto";

// Token ngắn hạn để trình duyệt (canvas) kết nối WebSocket tới worker.
// Dạng: base64url(JSON payload).base64url(HMAC-SHA256)
export type BrowserTokenPayload = { accountId: string; userId: string; exp: number };

function secret(): string {
  const s = process.env.WORKER_SECRET;
  if (!s || s.length < 32) throw new Error("WORKER_SECRET chưa cấu hình (tối thiểu 32 ký tự)");
  return s;
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

export function signBrowserToken(
  payload: Omit<BrowserTokenPayload, "exp">,
  ttlSec = 300,
  now = Date.now(),
): string {
  const full: BrowserTokenPayload = { ...payload, exp: Math.floor(now / 1000) + ttlSec };
  const body = Buffer.from(JSON.stringify(full)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyBrowserToken(token: string, now = Date.now()): BrowserTokenPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as BrowserTokenPayload;
    if (typeof payload.accountId !== "string" || typeof payload.userId !== "string") return null;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < now) return null;
    return payload;
  } catch {
    return null;
  }
}
