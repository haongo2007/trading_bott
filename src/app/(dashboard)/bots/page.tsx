import Link from "next/link";
import { Suspense } from "react";
import { Bot as BotIcon, Plus } from "lucide-react";
import { requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PageSkeleton } from "@/components/page-skeleton";
import { DIRECTION_MODE_LABELS, STAKE_MODE_LABELS, STOP_REASON_LABELS, tradingDate } from "@/lib/strategy";

export default function BotsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

const RUN_BADGE: Record<string, [string, string]> = {
  RUNNING: ["Đang chạy", "badge-info"],
  COMPLETED: ["Đã dừng", "badge-success"],
  STOPPED: ["Dừng tay", "badge-warning"],
  FAILED: ["Lỗi", "badge-error"],
  QUEUED: ["Chờ", "badge-ghost"],
  WAITING_HUMAN: ["Chờ người", "badge-warning"],
};

async function Content() {
  const user = await requireUser();
  const bots = await prisma.bot.findMany({
    orderBy: { createdAt: "desc" },
    include: { account: { select: { name: true } }, flow: { select: { name: true } } },
  });
  // Phiên hôm nay của từng bot (theo múi giờ & chế độ hiện tại của bot)
  const runs = await Promise.all(
    bots.map((b) =>
      prisma.botRun.findUnique({
        where: { botId_runDate_dryRun: { botId: b.id, runDate: new Date(`${tradingDate(new Date(), b.timezone)}T00:00:00Z`), dryRun: b.dryRun } },
        select: { status: true, pnl: true, stopReason: true, _count: { select: { orders: true } } },
      }),
    ),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Bot</h1>
          <p className="text-sm text-base-content/60">Mỗi bot = tài khoản sàn + flow đặt lệnh + chiến lược vốn/hướng + điều kiện dừng.</p>
        </div>
        {user.role !== "VIEWER" && (
          <Link href="/bots/new" className="btn btn-primary">
            <Plus className="size-4" /> Tạo bot
          </Link>
        )}
      </div>

      <div className="card bg-base-100 shadow-sm">
        {bots.length === 0 ? (
          <div className="card-body items-center py-16 text-center">
            <div className="grid size-16 place-items-center rounded-full bg-base-200">
              <BotIcon className="size-7 text-base-content/50" />
            </div>
            <h2 className="mt-2 text-lg font-semibold">Chưa có bot nào</h2>
            <p className="max-w-md text-sm text-base-content/60">
              Cần có sẵn 1 tài khoản sàn (đã cấu hình selector số dư) và 1 flow có khối <b>Đặt lệnh</b>.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Bot</th>
                  <th>Chế độ</th>
                  <th>Chiến lược</th>
                  <th>Hôm nay</th>
                  <th className="text-right">Lãi/lỗ hôm nay</th>
                </tr>
              </thead>
              <tbody>
                {bots.map((b, i) => {
                  const r = runs[i];
                  const pnl = r ? Number(r.pnl) : 0;
                  return (
                    <tr key={b.id} className="hover:bg-base-200/50">
                      <td>
                        <Link href={`/bots/${b.id}`} className="font-semibold hover:underline">
                          {b.name}
                        </Link>
                        <div className="text-xs text-base-content/60">
                          {b.account.name} · {b.flow?.name ?? "chưa chọn flow"}
                        </div>
                      </td>
                      <td>
                        {b.dryRun ? <span className="badge badge-success badge-soft">Chạy thử</span> : <span className="badge badge-warning">THẬT</span>}
                      </td>
                      <td className="text-sm">
                        <div>{STAKE_MODE_LABELS[b.stakeMode]}</div>
                        <div className="text-xs text-base-content/60">{DIRECTION_MODE_LABELS[b.directionMode]}</div>
                      </td>
                      <td>
                        {r ? (
                          <div className="space-y-0.5">
                            <span className={`badge badge-soft badge-sm ${RUN_BADGE[r.status][1]}`}>{RUN_BADGE[r.status][0]}</span>
                            <div className="text-xs text-base-content/60">
                              {r._count.orders} lệnh{r.stopReason ? ` · ${STOP_REASON_LABELS[r.stopReason]}` : ""}
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm text-base-content/40">Chưa chạy</span>
                        )}
                      </td>
                      <td className={`text-right font-mono ${pnl > 0 ? "text-success" : pnl < 0 ? "text-error" : ""}`}>
                        {r ? `${pnl > 0 ? "+" : ""}${pnl.toLocaleString("vi-VN")}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
