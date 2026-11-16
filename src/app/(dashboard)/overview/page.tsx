import Link from "next/link";
import { Suspense } from "react";
import { Brain, CalendarClock, MessageCircle, Server, TriangleAlert } from "lucide-react";
import { requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PageSkeleton } from "@/components/page-skeleton";
import { describeCron, nextRuns } from "@/lib/schedule";
import { getSetting } from "@/lib/settings";
import { STOP_REASON_LABELS, tradingDate } from "@/lib/strategy";
import { getWorkerHealth } from "../accounts/worker-actions";

export default function OverviewPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

const TZ = "Asia/Ho_Chi_Minh";
const fmt = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n).toLocaleString("vi-VN")}`;
const tone = (n: number) => (n > 0 ? "text-success" : n < 0 ? "text-error" : "");
const when = new Intl.DateTimeFormat("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: TZ });
const time = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: TZ });

async function Content() {
  await requireUser();
  const now = new Date();
  const today = new Date(`${tradingDate(now, TZ)}T00:00:00Z`);
  const [health, tg, bots, runsToday, problems, failedAccounts] = await Promise.all([
    getWorkerHealth(),
    getSetting("telegram"),
    prisma.bot.findMany({ orderBy: { name: "asc" }, include: { account: { select: { name: true } } } }),
    prisma.botRun.findMany({ where: { runDate: today }, include: { _count: { select: { orders: true } } } }),
    prisma.runLog.findMany({
      where: { level: { in: ["ERROR", "WARN"] }, createdAt: { gte: new Date(now.getTime() - 86_400_000) } },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { run: { select: { bot: { select: { id: true, name: true } } } } },
    }),
    prisma.tradingAccount.findMany({ where: { status: "LOGIN_FAILED" }, select: { id: true, name: true, lastError: true } }),
  ]);

  const real = runsToday.filter((r) => !r.dryRun);
  const paper = runsToday.filter((r) => r.dryRun);
  const sum = (rs: typeof runsToday) => rs.reduce((s, r) => s + Number(r.pnl), 0);
  const running = runsToday.filter((r) => r.status === "RUNNING").length;
  const ordersToday = runsToday.reduce((s, r) => s + r._count.orders, 0);
  const runOf = (botId: string, dryRun: boolean) => runsToday.find((r) => r.botId === botId && r.dryRun === dryRun);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Tổng quan</h1>
        <p className="text-sm text-base-content/60">Hôm nay {today.toISOString().slice(0, 10).split("-").reverse().join("/")}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Status icon={<Server className="size-5" />} title="Worker" ok={health.online} text={health.online ? `Đang chạy · ${health.liveSessions ?? 0} trình duyệt trực tiếp` : "Không phản hồi — chạy npm run worker"} />
        <Status icon={<Brain className="size-5" />} title="AI (Claude)" ok={!!health.aiConfigured} text={health.aiConfigured ? "Sẵn sàng" : "Chưa cấu hình (chỉ cần cho bot AI)"} neutral={!health.aiConfigured} />
        <Status icon={<MessageCircle className="size-5" />} title="Telegram" ok={tg.enabled} text={tg.enabled ? "Đang gửi thông báo" : "Tắt — bật trong Cài đặt"} neutral={!tg.enabled} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile title="Lãi/lỗ thật hôm nay" value={real.length ? fmt(sum(real)) : "—"} cls={tone(sum(real))} />
        <Tile title="Lãi/lỗ chạy thử hôm nay" value={paper.length ? fmt(sum(paper)) : "—"} cls={tone(sum(paper))} />
        <Tile title="Bot đang chạy" value={String(running)} sub={`${bots.length} bot`} />
        <Tile title="Lệnh hôm nay" value={String(ordersToday)} />
      </div>

      {(failedAccounts.length > 0 || problems.length > 0) && (
        <div className="card bg-base-100 shadow-sm">
          <div className="card-body p-4">
            <h2 className="card-title text-base">
              <TriangleAlert className="size-5 text-warning" /> Cần chú ý (24 giờ qua)
            </h2>
            <ul className="space-y-1.5 text-sm">
              {failedAccounts.map((a) => (
                <li key={a.id}>
                  <Link className="link font-medium" href={`/accounts/${a.id}`}>{a.name}</Link>: lỗi đăng nhập — {a.lastError}
                </li>
              ))}
              {problems.map((p) => (
                <li key={p.id} className={p.level === "ERROR" ? "text-error" : ""}>
                  <span className="mr-2 font-mono text-xs text-base-content/50">{time.format(p.createdAt)}</span>
                  <Link className="link font-medium" href={`/bots/${p.run.bot.id}`}>{p.run.bot.name}</Link>: {p.message}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="card bg-base-100 shadow-sm">
        <div className="card-body p-4">
          <h2 className="card-title text-base">
            <CalendarClock className="size-5 text-primary" /> Bot & lịch chạy
          </h2>
          {bots.length === 0 ? (
            <p className="text-sm text-base-content/60">
              Chưa có bot. Bắt đầu từ <Link className="link" href="/accounts">Tài khoản sàn</Link> → <Link className="link" href="/flows">Flow</Link> → <Link className="link" href="/bots/new">Tạo bot</Link>.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Bot</th>
                    <th>Lịch</th>
                    <th>Lần chạy tới</th>
                    <th>Hôm nay</th>
                    <th className="text-right">Lãi/lỗ</th>
                  </tr>
                </thead>
                <tbody>
                  {bots.map((b) => {
                    const r = runOf(b.id, b.dryRun);
                    const next = b.enabled ? nextRuns(b.cron, b.timezone, now, 1)[0] : null;
                    return (
                      <tr key={b.id}>
                        <td>
                          <Link href={`/bots/${b.id}`} className="font-medium hover:underline">{b.name}</Link>
                          <div className="text-xs text-base-content/60">
                            {b.account.name} · {b.dryRun ? "thử" : <b className="text-warning">THẬT</b>}
                          </div>
                        </td>
                        <td className="text-sm">{b.enabled ? describeCron(b.cron) : <span className="text-base-content/40">Tắt</span>}</td>
                        <td className="text-sm">{next ? when.format(next) : "—"}</td>
                        <td className="text-sm">
                          {r ? (r.status === "RUNNING" ? <span className="badge badge-info badge-sm">Đang chạy</span> : r.stopReason ? STOP_REASON_LABELS[r.stopReason] : r.status) : <span className="text-base-content/40">Chưa chạy</span>}
                        </td>
                        <td className={`text-right font-mono ${tone(r ? Number(r.pnl) : 0)}`}>{r ? fmt(Number(r.pnl)) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Status({ icon, title, ok, text, neutral }: { icon: React.ReactNode; title: string; ok: boolean; text: string; neutral?: boolean }) {
  const cls = ok ? "bg-success/15 text-success" : neutral ? "bg-base-200 text-base-content/60" : "bg-error/15 text-error";
  return (
    <div className="card bg-base-100 p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`grid size-10 place-items-center rounded-field ${cls}`}>{icon}</div>
        <div>
          <div className="font-semibold">{title}</div>
          <div className="text-sm text-base-content/60">{text}</div>
        </div>
      </div>
    </div>
  );
}

function Tile({ title, value, sub, cls = "" }: { title: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="card bg-base-100 p-4 shadow-sm">
      <div className="text-sm text-base-content/60">{title}</div>
      <div className={`text-2xl font-bold ${cls}`}>{value}</div>
      {sub && <div className="text-xs text-base-content/60">{sub}</div>}
    </div>
  );
}
