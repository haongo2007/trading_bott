import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Settings } from "lucide-react";
import { requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PageSkeleton } from "@/components/page-skeleton";
import { DIRECTION_MODE_LABELS, STAKE_MODE_LABELS, STOP_REASON_LABELS } from "@/lib/strategy";
import { BotMonitor } from "./bot-monitor";

export default function BotPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={params} />
    </Suspense>
  );
}

const dateFmt = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeZone: "UTC" });

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const bot = await prisma.bot.findUnique({
    where: { id },
    include: {
      account: { select: { id: true, name: true } },
      flow: { select: { id: true, name: true } },
      runs: { orderBy: { runDate: "desc" }, take: 14, include: { _count: { select: { orders: true } } } },
    },
  });
  if (!bot) notFound();
  const canWrite = user.role !== "VIEWER";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="breadcrumbs text-sm">
            <ul>
              <li>
                <Link href="/bots">Bot</Link>
              </li>
              <li>{bot.name}</li>
            </ul>
          </div>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold">
            {bot.name}
            {bot.dryRun ? <span className="badge badge-success badge-soft">Chạy thử (giả lập)</span> : <span className="badge badge-warning">CHẠY THẬT</span>}
          </h1>
          <p className="text-sm text-base-content/60">
            <Link className="link" href={`/accounts/${bot.account.id}`}>{bot.account.name}</Link> ·{" "}
            {bot.flow ? <Link className="link" href={`/flows/${bot.flow.id}`}>{bot.flow.name}</Link> : "chưa chọn flow"} ·{" "}
            {STAKE_MODE_LABELS[bot.stakeMode]} · {DIRECTION_MODE_LABELS[bot.directionMode]}
          </p>
        </div>
        {canWrite && (
          <Link href={`/bots/${id}/edit`} className="btn btn-sm btn-ghost">
            <Settings className="size-4" /> Cài đặt
          </Link>
        )}
      </div>

      <BotMonitor botId={id} dryRun={bot.dryRun} canWrite={canWrite} maxOrders={bot.maxOrdersPerDay} dailyBudget={Number(bot.dailyBudget)} />

      <div className="card bg-base-100 shadow-sm">
        <div className="card-body p-4">
          <h2 className="card-title text-base">Lịch sử các ngày</h2>
          {bot.runs.length === 0 ? (
            <p className="text-sm text-base-content/60">Chưa có phiên nào.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Ngày</th>
                    <th>Chế độ</th>
                    <th className="text-center">Số lệnh</th>
                    <th>Kết thúc</th>
                    <th className="text-right">Lãi/lỗ</th>
                  </tr>
                </thead>
                <tbody>
                  {bot.runs.map((r) => {
                    const pnl = Number(r.pnl);
                    return (
                      <tr key={r.id}>
                        <td>{dateFmt.format(r.runDate)}</td>
                        <td>{r.dryRun ? "Thử" : "Thật"}</td>
                        <td className="text-center">{r._count.orders}</td>
                        <td className="text-sm">{r.status === "RUNNING" ? "Đang chạy" : r.stopReason ? STOP_REASON_LABELS[r.stopReason] : r.status}</td>
                        <td className={`text-right font-mono ${pnl > 0 ? "text-success" : pnl < 0 ? "text-error" : ""}`}>
                          {pnl > 0 ? "+" : ""}
                          {pnl.toLocaleString("vi-VN")}
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
    </div>
  );
}
