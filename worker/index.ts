import "dotenv/config";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { prisma } from "@/lib/prisma";
import { verifyBrowserToken } from "@/lib/worker-token";
import { CapacityError, closeBrowser, contextStats, getBrowser, lockedAccounts, log, tryLockAccount, unlockAccount } from "./browser-pool";
import { commandStats, recoverStaleCommands, startCommandLoop } from "./commands";
import { LiveSession } from "./live-session";
import { startScheduler } from "./scheduler";

const HOST = process.env.WORKER_HOST ?? "127.0.0.1";
const PORT = Number(process.env.WORKER_PORT ?? 3001);
const APP_ORIGIN = process.env.APP_ORIGIN; // VD http://localhost:3000 — chặn kết nối WS từ trang lạ
const startedAt = Date.now();
const sessions = new Set<LiveSession>();

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        liveSessions: sessions.size,
        contexts: contextStats(),
        commands: commandStats(),
        locks: lockedAccounts().length,
        aiConfigured: !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE),
      }),
    );
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server, path: "/live", maxPayload: 64 * 1024 });

wss.on("connection", async (ws, req) => {
  if (APP_ORIGIN && req.headers.origin !== APP_ORIGIN) return ws.close(4401, "origin");
  const token = new URL(req.url ?? "", "http://localhost").searchParams.get("token") ?? "";
  const payload = verifyBrowserToken(token);
  if (!payload) return ws.close(4401, "unauthorized");

  const account = await prisma.tradingAccount.findUnique({ where: { id: payload.accountId } });
  if (!account) return ws.close(4404, "not found");

  const session = new LiveSession(ws, account);
  if (!tryLockAccount(account.id, session.owner)) return ws.close(4409, "busy");

  sessions.add(session);
  ws.on("close", () => {
    sessions.delete(session);
    session.close("ws closed").catch(() => {});
  });
  try {
    await session.start();
  } catch (e) {
    log("live", account.id, "Không mở được phiên:", (e as Error).message);
    unlockAccount(account.id, session.owner);
    sessions.delete(session);
    ws.close(e instanceof CapacityError ? 4429 : 1011, "error");
    await session.close("start failed");
  }
});

const abort = new AbortController();

async function main() {
  await prisma.$queryRaw`SELECT 1`;
  await recoverStaleCommands();
  await getBrowser();
  startCommandLoop(abort.signal);
  startScheduler(abort.signal);
  server.listen(PORT, HOST, () => log("worker", `Sẵn sàng tại http://${HOST}:${PORT} (WS: /live, health: /health)`));
}

async function shutdown(signal: string) {
  log("worker", `Nhận ${signal}, đang tắt...`);
  abort.abort();
  for (const s of sessions) await s.close("shutdown");
  wss.close();
  server.close();
  await closeBrowser();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((e) => {
  log("worker", "Khởi động thất bại:", e);
  process.exit(1);
});
