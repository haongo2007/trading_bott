import { chromium, type Browser, type BrowserContext } from "playwright";
import type { TradingAccount } from "@/generated/prisma/client";
import { decrypt } from "@/lib/crypto";

export function log(scope: string, ...args: unknown[]) {
  console.log(new Date().toISOString(), `[${scope}]`, ...args);
}

// ───── Một Chromium dùng chung, mỗi tài khoản một BrowserContext (cookie/storage tách biệt) ─────

let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  const proxy = proxyConfig();
  launching ??= chromium
    .launch({
      headless: process.env.WORKER_HEADLESS !== "false",
      args: [
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        // Giảm tải trên server không có GPU / ít RAM
        "--disable-extensions",
        "--disable-component-update",
        "--disable-background-networking",
        "--disable-default-apps",
        "--disable-sync",
        "--no-first-run",
        "--mute-audio",
        "--disable-features=Translate,MediaRouter,OptimizationHints,BackForwardCache",
      ],
      ...(proxy && { proxy }),
    })
    .then((b) => {
      browser = b;
      b.on("disconnected", () => {
        log("browser", "Chromium đã thoát");
        browser = null;
      });
      log("browser", "Đã khởi động Chromium", b.version(), proxy ? `(qua proxy ${proxy.server})` : "(truy cập trực tiếp)");
      return b;
    })
    .finally(() => {
      launching = null;
    });
  return launching;
}

/**
 * Proxy cho Chromium (tuỳ chọn). Dùng khi worker chạy ở máy local bị nhà mạng chặn website:
 *   ssh -N -D 1080 user@vps            # mở tunnel SOCKS5 qua VPS
 *   WORKER_PROXY_SERVER=socks5://127.0.0.1:1080
 * Với socks5, Chromium phân giải tên miền ở phía VPS → tránh được cả chặn bằng DNS.
 * Địa chỉ local (sàn giả lập, localhost) luôn truy cập trực tiếp.
 */
export function proxyConfig(): { server: string; bypass: string } | null {
  const server = process.env.WORKER_PROXY_SERVER?.trim();
  if (!server) return null;
  if (!/^(socks5|socks4|http|https):\/\/[^\s]+$/i.test(server)) {
    throw new Error(`WORKER_PROXY_SERVER không hợp lệ: "${server}" (VD socks5://127.0.0.1:1080)`);
  }
  return { server, bypass: "localhost,127.0.0.1,::1" };
}

/**
 * User-agent giống Chrome thật. Headless mặc định gửi "HeadlessChrome/x.y" → nhiều WAF trả 403 ngay.
 * Dùng đúng phiên bản Chromium đang chạy (khớp với Client Hints) và đúng hệ điều hành của máy.
 * Ghi đè bằng WORKER_USER_AGENT nếu cần.
 */
function realUserAgent(b: Browser): string {
  const custom = process.env.WORKER_USER_AGENT?.trim();
  if (custom) return custom;
  const major = b.version().split(".")[0];
  const platform =
    process.platform === "darwin"
      ? "Macintosh; Intel Mac OS X 10_15_7"
      : process.platform === "win32"
        ? "Windows NT 10.0; Win64; x64"
        : "X11; Linux x86_64";
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

function acceptLanguage(locale: string): string {
  const lang = locale.split("-")[0];
  return lang === "en" ? `${locale},en;q=0.9` : `${locale},${lang};q=0.9,en-US;q=0.8,en;q=0.7`;
}

export async function closeBrowser() {
  await browser?.close().catch(() => {});
  browser = null;
}

const MAX_CONTEXTS = Number(process.env.MAX_BROWSER_CONTEXTS ?? 8);
let activeContexts = 0;

export class CapacityError extends Error {}

/**
 * Bot chạy nền không cần xem hình → có thể chặn ảnh/font/video để giảm CPU, RAM, băng thông.
 * Bật bằng WORKER_BLOCK_HEAVY=true. Phiên trực tiếp (live view) không bao giờ bị chặn.
 * Không ảnh hưởng canvas/biểu đồ vẽ bằng JS; chỉ chặn file ảnh/font/media tải từ mạng.
 */
const BLOCK_HEAVY = process.env.WORKER_BLOCK_HEAVY === "true";
const HEAVY_TYPES = new Set(["image", "media", "font"]);

export async function newAccountContext(
  account: TradingAccount,
  opts: { headlessRun?: boolean } = {},
): Promise<BrowserContext> {
  if (activeContexts >= MAX_CONTEXTS) throw new CapacityError(`Đã đạt tối đa ${MAX_CONTEXTS} phiên trình duyệt`);
  activeContexts++;
  try {
    const b = await getBrowser();
    const storageState = account.storageStateEnc ? JSON.parse(decrypt(account.storageStateEnc)) : undefined;
    const ctx = await b.newContext({
      viewport: { width: account.viewportWidth, height: account.viewportHeight },
      locale: account.locale,
      timezoneId: account.timezone,
      userAgent: realUserAgent(b),
      extraHTTPHeaders: { "Accept-Language": acceptLanguage(account.locale) },
      storageState,
    });
    ctx.on("close", () => activeContexts--);
    if (opts.headlessRun && BLOCK_HEAVY) {
      await ctx.route("**/*", (route) =>
        HEAVY_TYPES.has(route.request().resourceType()) ? route.abort() : route.continue(),
      );
    }
    return ctx;
  } catch (e) {
    activeContexts--;
    throw e;
  }
}

export function contextStats() {
  return { active: activeContexts, max: MAX_CONTEXTS };
}

// ───── Khoá theo tài khoản: không bao giờ có 2 phiên cùng điều khiển 1 tài khoản ─────

const locks = new Map<string, string>();

export function tryLockAccount(accountId: string, owner: string): boolean {
  if (locks.has(accountId)) return false;
  locks.set(accountId, owner);
  return true;
}

export function unlockAccount(accountId: string, owner: string) {
  if (locks.get(accountId) === owner) locks.delete(accountId);
}

export function lockedAccounts() {
  return [...locks.entries()].map(([accountId, owner]) => ({ accountId, owner }));
}
