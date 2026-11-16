import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { TradingAccount } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { decrypt, encrypt } from "@/lib/crypto";
import { parseBalance } from "@/lib/balance";
import { log, newAccountContext } from "./browser-pool";

export type LoginOutcome =
  | { ok: true; via: "SESSION" | "FORM"; balance: number | null; balanceText: string | null }
  | { ok: false; error: string; screenshot?: string };

const STORAGE_DIR = process.env.STORAGE_DIR ?? "storage";

/** Đã đăng nhập chưa? Ưu tiên successSelector; nếu không có thì dùng heuristic. */
export async function isLoggedIn(page: Page, account: TradingAccount, timeoutMs: number): Promise<boolean> {
  if (account.successSelector) {
    try {
      await page.locator(account.successSelector).first().waitFor({ state: "visible", timeout: timeoutMs });
      return true;
    } catch {
      return false;
    }
  }
  // Heuristic: không còn ở trang đăng nhập và không còn ô mật khẩu hiển thị
  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {});
  const onLoginPage = stripQuery(page.url()) === stripQuery(account.loginUrl);
  const passwordVisible = await page.locator("input[type=password]").first().isVisible().catch(() => false);
  return !onLoginPage && !passwordVisible;
}

/** Điền form đăng nhập trên page hiện tại. Ném lỗi với thông báo dễ hiểu nếu thiếu selector/phần tử. */
export async function performFormLogin(page: Page, account: TradingAccount) {
  const { usernameSelector, passwordSelector, submitSelector } = account;
  if (!usernameSelector || !passwordSelector || !submitSelector) {
    throw new Error("Chưa cấu hình đủ selector form đăng nhập (ô tên đăng nhập, ô mật khẩu, nút đăng nhập)");
  }
  const timeout = account.loginTimeoutSec * 1000;
  await page.goto(account.loginUrl, { waitUntil: "domcontentloaded", timeout });

  const user = page.locator(usernameSelector).first();
  await user.waitFor({ state: "visible", timeout }).catch(() => {
    throw new Error(`Không tìm thấy ô tên đăng nhập: ${usernameSelector}`);
  });
  await user.fill(decrypt(account.usernameEnc));

  const pass = page.locator(passwordSelector).first();
  await pass.fill(decrypt(account.passwordEnc), { timeout }).catch(() => {
    throw new Error(`Không tìm thấy ô mật khẩu: ${passwordSelector}`);
  });

  await page.locator(submitSelector).first().click({ timeout }).catch(() => {
    throw new Error(`Không bấm được nút đăng nhập: ${submitSelector}`);
  });
}

export async function readBalance(page: Page, account: TradingAccount) {
  if (!account.balanceSelector) return { balance: null, balanceText: null };
  const el = page.locator(account.balanceSelector).first();
  const text = await el
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => el.innerText())
    .catch(() => null);
  return { balance: parseBalance(text), balanceText: text?.trim() ?? null };
}

/** Đảm bảo page đang đăng nhập: thử phiên đã lưu trước, nếu không được thì đăng nhập bằng form. */
export async function ensureLoggedIn(page: Page, account: TradingAccount): Promise<"SESSION" | "FORM"> {
  const timeout = account.loginTimeoutSec * 1000;

  if (account.storageStateEnc) {
    await page.goto(account.tradeUrl, { waitUntil: "domcontentloaded", timeout });
    if (await isLoggedIn(page, account, Math.min(timeout, 10_000))) return "SESSION";
    log("login", account.id, "Phiên đã lưu không còn hiệu lực");
  }

  if (account.loginMethod === "SESSION") {
    throw new Error("Phiên đăng nhập đã hết hạn hoặc chưa có. Mở “Trình duyệt trực tiếp” để đăng nhập và lưu phiên.");
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= account.maxLoginRetries; attempt++) {
    try {
      await performFormLogin(page, account);
      if (await isLoggedIn(page, account, timeout)) {
        if (stripQuery(page.url()) !== stripQuery(account.tradeUrl)) {
          await page.goto(account.tradeUrl, { waitUntil: "domcontentloaded", timeout });
        }
        return "FORM";
      }
      lastError = new Error("Đã gửi form nhưng không thấy dấu hiệu đăng nhập thành công (sai mật khẩu hoặc selector “Dấu hiệu đã đăng nhập” chưa đúng)");
    } catch (e) {
      lastError = e;
    }
    log("login", account.id, `Lần thử ${attempt + 1} thất bại:`, (lastError as Error).message);
  }
  throw lastError;
}

export async function saveStorageState(context: BrowserContext, accountId: string) {
  const state = await context.storageState();
  await prisma.tradingAccount.update({
    where: { id: accountId },
    data: { storageStateEnc: encrypt(JSON.stringify(state)) },
  });
}

export async function screenshotOnError(page: Page, accountId: string): Promise<string | undefined> {
  try {
    const dir = path.join(STORAGE_DIR, "screenshots");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${accountId}-${Date.now()}.png`);
    await page.screenshot({ path: file });
    return file;
  } catch {
    return undefined;
  }
}

/** Kiểm tra đăng nhập độc lập (lệnh TEST_LOGIN): mở context riêng, đăng nhập, đọc số dư, lưu phiên. */
export async function runTestLogin(accountId: string): Promise<LoginOutcome> {
  const account = await prisma.tradingAccount.findUnique({ where: { id: accountId } });
  if (!account) return { ok: false, error: "Không tìm thấy tài khoản" };
  if (account.status === "DISABLED") return { ok: false, error: "Tài khoản đang tạm khoá" };

  const context = await newAccountContext(account);
  const page = await context.newPage();
  try {
    const via = await ensureLoggedIn(page, account);
    const { balance, balanceText } = await readBalance(page, account);
    await saveStorageState(context, account.id);
    await prisma.tradingAccount.update({
      where: { id: account.id },
      data: {
        status: "ACTIVE",
        lastLoginAt: new Date(),
        lastError: null,
        ...(balance != null && { lastBalance: balance }),
      },
    });
    log("login", account.id, `OK qua ${via}, số dư: ${balanceText ?? "—"}`);
    return { ok: true, via, balance, balanceText };
  } catch (e) {
    const error = (e as Error).message?.split("\n")[0] ?? "Lỗi không xác định";
    const screenshot = await screenshotOnError(page, account.id);
    await prisma.tradingAccount.update({
      where: { id: account.id },
      data: { status: "LOGIN_FAILED", lastError: error },
    });
    return { ok: false, error, screenshot };
  } finally {
    await context.close().catch(() => {});
  }
}

function stripQuery(u: string) {
  try {
    const url = new URL(u);
    return url.origin + url.pathname.replace(/\/$/, "");
  } catch {
    return u;
  }
}
