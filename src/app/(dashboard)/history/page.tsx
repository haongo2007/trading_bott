import { Suspense } from "react";
import { Download } from "lucide-react";
import { requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PageSkeleton } from "@/components/page-skeleton";
import { CumulativePnlChart, DailyPnlChart } from "@/components/pnl-charts";
import { byBot, dailySeries, summarize, type RunRow } from "@/lib/report";
import { tradingDate } from "@/lib/strategy";

type Search = { range?: string; mode?: string; bot?: string };
const TZ = "Asia/Ho_Chi_Minh";
const RANGES = [7, 30, 90] as const;

export default function HistoryPage({ searchParams }: { searchParams: Promise<Search> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

const fmt = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n).toLocaleString("vi-VN")}`;
const tone = (n: number) => (n > 0 ? "text-success" : n < 0 ? "text-error" : "");

async function Content({ searchParams }: { searchParams: Promise<Search> }) {
  await requireUser();
  const sp = await searchParams;
  const range = RANGES.includes(Number(sp.range) as (typeof RANGES)[number]) ? Number(sp.range) : 30;
  const mode = sp.mode === "dry" || sp.mode === "all" ? sp.mode : "real";
  const botId = sp.bot || "";

  const to = tradingDate(new Date(), TZ);
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - (range - 1) * 86_400_000).toISOString().slice(0, 10);

  const [bots, runs] = await Promise.all([
    prisma.bot.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.botRun.findMany({
      where: {
        runDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
        ...(mode !== "all" && { dryRun: mode === "dry" }),
        ...(botId && { botId }),
      },
      include: { bot: { select: { name: true } }, orders: { select: { result: true } } },
    }),
  ]);

  const rows: RunRow[] = runs.map((r) => ({
    date: r.runDate.toISOString().slice(0, 10),
    botId: r.botId,
    botName: r.bot.name,
    pnl: Number(r.pnl),
    orders: r.orders.length,
    wins: r.orders.filter((o) => o.result === "WIN").length,
    losses: r.orders.filter((o) => o.result === "LOSS").length,
  }));
  const days = dailySeries(rows, from, to);
  const s = summarize(days);
  const perBot = byBot(rows);
  const csvQuery = new URLSearchParams({ from, to, mode, ...(botId && { bot: botId }) }).toString();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Lịch sử & báo cáo</h1>
          <p className="text-sm text-base-content/60">
            Từ {from.split("-").reverse().join("/")} đến {to.split("-").reverse().join("/")} · {mode === "real" ? "chỉ lệnh thật" : mode === "dry" ? "chỉ chạy thử (giả lập)" : "thật + thử"}
          </p>
        </div>
        <a href={`/api/reports/orders?${csvQuery}`} className="btn btn-sm">
          <Download className="size-4" /> Xuất CSV các lệnh
        </a>
      </div>

      {/* Bộ lọc: 1 hàng phía trên biểu đồ */}
      <form method="get" className="card flex-row flex-wrap items-end gap-3 bg-base-100 p-4 shadow-sm">
        <fieldset className="fieldset py-0">
          <legend className="fieldset-legend">Khoảng thời gian</legend>
          <select name="range" defaultValue={String(range)} className="select select-sm">
            {RANGES.map((r) => (
              <option key={r} value={r}>
                {r} ngày gần nhất
              </option>
            ))}
          </select>
        </fieldset>
        <fieldset className="fieldset py-0">
          <legend className="fieldset-legend">Chế độ</legend>
          <select name="mode" defaultValue={mode} className="select select-sm">
            <option value="real">Thật</option>
            <option value="dry">Chạy thử (giả lập)</option>
            <option value="all">Tất cả</option>
          </select>
        </fieldset>
        <fieldset className="fieldset py-0">
          <legend className="fieldset-legend">Bot</legend>
          <select name="bot" defaultValue={botId} className="select select-sm">
            <option value="">Tất cả bot</option>
            {bots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </fieldset>
        <button className="btn btn-sm btn-primary">Xem</button>
      </form>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile title="Tổng lãi/lỗ" value={fmt(s.total)} cls={tone(s.total)} sub={`${s.activeDays} ngày có lệnh`} />
        <Tile title="Ngày lãi / lỗ" value={`${s.profitDays} / ${s.lossDays}`} sub={s.best ? `Tốt nhất ${fmt(s.best.pnl)} · Tệ nhất ${fmt(s.worst!.pnl)}` : "—"} />
        <Tile title="Tỉ lệ thắng lệnh" value={s.winRate === null ? "—" : `${(s.winRate * 100).toFixed(1)}%`} sub={`${s.orders} lệnh`} />
        <Tile title="Sụt giảm lớn nhất" value={s.maxDrawdown ? `-${Math.round(s.maxDrawdown).toLocaleString("vi-VN")}` : "0"} cls={s.maxDrawdown ? "text-error" : ""} sub="Từ đỉnh lãi tích luỹ xuống đáy" />
      </div>

      {s.activeDays === 0 ? (
        <div className="card bg-base-100 p-10 text-center text-base-content/60 shadow-sm">Không có phiên nào trong khoảng này.</div>
      ) : (
        <>
          <div className="card bg-base-100 shadow-sm">
            <div className="card-body p-4">
              <h2 className="card-title text-base">Lãi/lỗ theo ngày</h2>
              <DailyPnlChart days={days} />
            </div>
          </div>
          <div className="card bg-base-100 shadow-sm">
            <div className="card-body p-4">
              <h2 className="card-title text-base">Lãi/lỗ tích luỹ</h2>
              <CumulativePnlChart days={days} />
            </div>
          </div>
        </>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="card bg-base-100 shadow-sm">
          <div className="card-body p-4">
            <h2 className="card-title text-base">Theo bot</h2>
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Bot</th>
                    <th className="text-center">Ngày</th>
                    <th className="text-center">Lệnh</th>
                    <th className="text-center">Thắng</th>
                    <th className="text-right">Lãi/lỗ</th>
                  </tr>
                </thead>
                <tbody>
                  {perBot.map((b) => (
                    <tr key={b.botId}>
                      <td className="font-medium">{b.botName}</td>
                      <td className="text-center">{b.days}</td>
                      <td className="text-center">{b.orders}</td>
                      <td className="text-center">{b.wins + b.losses ? `${Math.round((b.wins / (b.wins + b.losses)) * 100)}%` : "—"}</td>
                      <td className={`text-right font-mono ${tone(b.pnl)}`}>{fmt(b.pnl)}</td>
                    </tr>
                  ))}
                  {!perBot.length && (
                    <tr>
                      <td colSpan={5} className="text-center text-base-content/50">Không có dữ liệu</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="card bg-base-100 shadow-sm">
          <div className="card-body p-4">
            <h2 className="card-title text-base">Theo ngày (bảng)</h2>
            <div className="max-h-96 overflow-auto">
              <table className="table table-sm table-pin-rows">
                <thead>
                  <tr>
                    <th>Ngày</th>
                    <th className="text-center">Lệnh</th>
                    <th className="text-center">T / B</th>
                    <th className="text-right">Lãi/lỗ</th>
                    <th className="text-right">Tích luỹ</th>
                  </tr>
                </thead>
                <tbody>
                  {[...days].reverse().filter((d) => d.orders > 0).map((d) => (
                    <tr key={d.date}>
                      <td>{d.date.split("-").reverse().join("/")}</td>
                      <td className="text-center">{d.orders}</td>
                      <td className="text-center">{d.wins} / {d.losses}</td>
                      <td className={`text-right font-mono ${tone(d.pnl)}`}>{fmt(d.pnl)}</td>
                      <td className="text-right font-mono">{fmt(d.cumulative)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
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
