import { prisma } from "@/lib/prisma";
import type { Command, CommandType } from "@/generated/prisma/client";
import { CapacityError, log, tryLockAccount, unlockAccount } from "./browser-pool";
import { runTestLogin } from "./login";
import { runFlowCommand, type RunFlowPayload } from "./flow-runner";
import { recoverStaleRuns, runBot } from "./bot-runner";
import { esc, notify } from "./notifier";

const POLL_MS = 1500;
// Lệnh ngắn (kiểm tra đăng nhập, chạy thử flow) và phiên bot (chạy lâu) có giới hạn song song riêng
const MAX_PARALLEL = Number(process.env.MAX_PARALLEL_COMMANDS ?? 3);
const MAX_BOT_RUNS = Number(process.env.MAX_BOT_RUNS ?? 6);
let running = 0;
let botsRunning = 0;

/** Khi worker khởi động lại, các lệnh/phiên đang xử lý dở coi như thất bại. */
export async function recoverStaleCommands() {
  const { count } = await prisma.command.updateMany({
    where: { status: "PROCESSING" },
    data: { status: "FAILED", result: JSON.stringify({ ok: false, error: "Worker đã khởi động lại khi lệnh đang chạy" }) },
  });
  if (count) log("commands", `Đánh dấu ${count} lệnh dở dang là FAILED`);
  await recoverStaleRuns();
}

async function claimNext(types: CommandType[]): Promise<Command | null> {
  const cmd = await prisma.command.findFirst({
    where: { status: "PENDING", type: { in: types } },
    orderBy: { createdAt: "asc" },
  });
  if (!cmd) return null;
  // Claim nguyên tử: chỉ 1 worker chuyển được PENDING → PROCESSING
  const { count } = await prisma.command.updateMany({
    where: { id: cmd.id, status: "PENDING" },
    data: { status: "PROCESSING" },
  });
  return count === 1 ? cmd : null;
}

async function finish(id: string, ok: boolean, result: unknown) {
  const data = { status: ok ? ("DONE" as const) : ("FAILED" as const), result: JSON.stringify(result) };
  // Không ghi đè lệnh đã bị người dùng huỷ — chỉ cập nhật kết quả
  const { count } = await prisma.command.updateMany({ where: { id, status: { in: ["PENDING", "PROCESSING"] } }, data });
  if (!count) await prisma.command.update({ where: { id }, data: { result: data.result } });
}

async function execute(cmd: Command) {
  const accountId = cmd.accountId;
  if (!accountId) return finish(cmd.id, false, { ok: false, error: "Thiếu accountId" });

  const owner = `cmd:${cmd.id}`;
  if (!tryLockAccount(accountId, owner)) {
    return finish(cmd.id, false, { ok: false, error: "Tài khoản đang được dùng ở phiên khác (đóng trình duyệt trực tiếp hoặc dừng bot rồi thử lại)" });
  }
  log("commands", `Bắt đầu ${cmd.type} cho ${accountId}`);
  try {
    if (cmd.type === "RUN_FLOW") {
      const result = await runFlowCommand(cmd.id, accountId, cmd.payload as unknown as RunFlowPayload);
      await finish(cmd.id, !!result.ok, result);
    } else {
      const outcome = await runTestLogin(accountId);
      await finish(cmd.id, outcome.ok, outcome);
      if (!outcome.ok) {
        const acc = await prisma.tradingAccount.findUnique({ where: { id: accountId }, select: { name: true } });
        await notify("LOGIN_FAILED", `🔑 Đăng nhập thất bại: <b>${esc(acc?.name ?? accountId)}</b>\n${esc(outcome.error)}`);
      }
    }
  } catch (e) {
    const error = e instanceof CapacityError ? e.message : `Lỗi worker: ${(e as Error).message.split("\n")[0]}`;
    await finish(cmd.id, false, { ok: false, error });
  } finally {
    unlockAccount(accountId, owner);
  }
}

async function executeBot(cmd: Command) {
  log("commands", `Bắt đầu chạy bot ${cmd.botId}`);
  try {
    const r = await runBot(cmd);
    await finish(cmd.id, r.ok, r);
    if (!r.ok && !r.runId) {
      // Không khởi động được (ngoài khung giờ, đã dừng hôm nay, thiếu cấu hình…) — bot-runner chưa gửi thông báo
      const bot = await prisma.bot.findUnique({ where: { id: cmd.botId! }, select: { name: true } });
      const scheduled = (cmd.payload as { scheduledAt?: string } | null)?.scheduledAt;
      await notify("BOT_ERROR", `⚠️ <b>${esc(bot?.name ?? "Bot")}</b> không khởi động được${scheduled ? " (theo lịch)" : ""}:\n${esc(r.message)}`);
    }
  } catch (e) {
    const error = e instanceof CapacityError ? e.message : `Lỗi worker: ${(e as Error).message.split("\n")[0]}`;
    await finish(cmd.id, false, { ok: false, message: error });
  }
}

export function startCommandLoop(signal: AbortSignal) {
  const tick = async () => {
    while (!signal.aborted && running < MAX_PARALLEL) {
      const cmd = await claimNext(["TEST_LOGIN", "RUN_FLOW"]);
      if (!cmd) break;
      running++;
      execute(cmd)
        .catch((e) => log("commands", "Lỗi không mong đợi", e))
        .finally(() => running--);
    }
    while (!signal.aborted && botsRunning < MAX_BOT_RUNS) {
      const cmd = await claimNext(["START"]);
      if (!cmd) break;
      botsRunning++;
      executeBot(cmd)
        .catch((e) => log("commands", "Lỗi không mong đợi khi chạy bot", e))
        .finally(() => botsRunning--);
    }
  };
  const loop = async () => {
    while (!signal.aborted) {
      await tick().catch((e) => log("commands", "Lỗi khi lấy lệnh", (e as Error).message));
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  };
  loop();
}

export function commandStats() {
  return { running, maxParallel: MAX_PARALLEL, botsRunning, maxBotRuns: MAX_BOT_RUNS };
}
