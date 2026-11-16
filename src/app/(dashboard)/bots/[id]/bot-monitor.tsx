"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Brain, CircleCheck, CircleHelp, CircleX, OctagonX, Play, Square, TrendingDown, TrendingUp } from "lucide-react";
import { STOP_REASON_LABELS, type StopReasonKind } from "@/lib/strategy";
import { getBotLive, startBot, stopBot, type BotLiveView } from "../actions";

type Props = { botId: string; dryRun: boolean; canWrite: boolean; maxOrders: number; dailyBudget: number };

const fmt = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("vi-VN"));
const signed = (n: number) => `${n > 0 ? "+" : ""}${fmt(n)}`;
const timeFmt = new Intl.DateTimeFormat("vi-VN", { timeStyle: "medium", timeZone: "Asia/Ho_Chi_Minh" });

export function BotMonitor({ botId, dryRun, canWrite, maxOrders, dailyBudget }: Props) {
  const [view, setView] = useState<BotLiveView>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const alive = useRef(true);
  const router = useRouter();

  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    let wasRunning = false;
    const tick = async () => {
      try {
        const v = await getBotLive(botId);
        if (!alive.current) return;
        setView(v);
        const running = v?.run?.status === "RUNNING" || v?.command?.status === "PENDING" || v?.command?.status === "PROCESSING";
        if (wasRunning && !running) router.refresh(); // cập nhật bảng lịch sử
        wasRunning = running;
        timer = setTimeout(tick, running ? 2000 : 5000);
      } catch {
        timer = setTimeout(tick, 5000);
      }
    };
    tick();
    return () => {
      alive.current = false;
      clearTimeout(timer);
    };
  }, [botId, router]);

  const run = view?.run;
  const cmd = view?.command;
  const pendingStart = cmd?.status === "PENDING";
  const running = run?.status === "RUNNING" || cmd?.status === "PROCESSING";

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => {
    setBusy(true);
    try {
      const r = await fn();
      setNotice(r.ok ? ok : (r.error ?? "Không thực hiện được"));
    } finally {
      setBusy(false);
    }
  };

  const orders = run?.orders ?? [];
  const settled = orders.filter((o) => o.result === "WIN" || o.result === "LOSS");
  const wins = settled.filter((o) => o.result === "WIN").length;
  const staked = orders.reduce((s, o) => s + o.amount, 0);
  const pnl = run?.pnl ?? 0;
  const target = run?.targetAmount ?? 0;
  const lossLimit = run?.lossLimit ?? 0;
  let lossStreak = 0;
  for (const o of orders) {
    if (o.result === "LOSS") lossStreak++;
    else if (o.result === "WIN") break;
  }
  const lastFailMsg = cmd && (cmd.status === "FAILED" || (cmd.status === "DONE" && !run)) ? cmd.message : null;

  return (
    <div className="space-y-4">
      {/* Điều khiển */}
      <div className="card bg-base-100 shadow-sm">
        <div className="card-body flex-row flex-wrap items-center gap-3 p-4">
          <StatusBadge status={run?.status} pendingStart={pendingStart} />
          {run?.stopReason && run.status !== "RUNNING" && (
            <span className="text-sm text-base-content/70">{STOP_REASON_LABELS[run.stopReason as StopReasonKind]}{run.error ? ` — ${run.error}` : ""}</span>
          )}
          {pendingStart && cmd && cmd.ageSec > 8 && (
            <span className="text-sm text-warning">Đang chờ worker… Worker đã chạy chưa? (npm run worker)</span>
          )}
          {canWrite && (
            <div className="ml-auto flex flex-wrap gap-2">
              {running || pendingStart ? (
                <>
                  <button className="btn btn-sm btn-warning" disabled={busy} onClick={() => act(() => stopBot(botId), "Đã gửi lệnh dừng — bot sẽ dừng sau khi xong lệnh hiện tại")}>
                    <Square className="size-4" /> Dừng sau lệnh này
                  </button>
                  <button
                    className="btn btn-sm btn-error"
                    disabled={busy}
                    onClick={() => window.confirm("Ngắt bot NGAY (kể cả giữa chừng một lệnh)?") && act(() => stopBot(botId, true), "Đã gửi lệnh dừng khẩn cấp")}
                  >
                    <OctagonX className="size-4" /> Dừng ngay
                  </button>
                </>
              ) : (
                <button
                  className={`btn btn-sm ${dryRun ? "btn-success" : "btn-warning"}`}
                  disabled={busy}
                  onClick={() => {
                    if (!dryRun && !window.confirm("Bot sẽ ĐẶT LỆNH THẬT bằng tiền thật. Tiếp tục?")) return;
                    act(() => startBot(botId), "Đã gửi lệnh chạy");
                  }}
                >
                  <Play className="size-4" /> {dryRun ? "Chạy thử ngay" : "Chạy thật ngay"}
                </button>
              )}
            </div>
          )}
        </div>
        {notice && <div className="border-t border-base-300 px-4 py-2 text-sm">{notice}</div>}
        {lastFailMsg && !running && (
          <div className="alert alert-error alert-soft rounded-none rounded-b-box border-x-0 border-b-0 text-sm">
            <CircleX className="size-4" /> Lần chạy gần nhất không khởi động được: {lastFailMsg}
          </div>
        )}
      </div>

      {/* Chỉ số hôm nay */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card bg-base-100 p-4 shadow-sm">
          <div className="text-sm text-base-content/60">Lãi/lỗ hôm nay{dryRun ? " (giả lập)" : ""}</div>
          <div className={`text-2xl font-bold ${pnl > 0 ? "text-success" : pnl < 0 ? "text-error" : ""}`}>{run ? signed(pnl) : "—"}</div>
          <div className="text-xs text-base-content/60">Số dư đầu ngày {fmt(run?.startBalance)}</div>
        </div>
        <div className="card bg-base-100 p-4 shadow-sm">
          <div className="flex justify-between text-sm">
            <span className="text-base-content/60">Tới mục tiêu</span>
            <span>{target > 0 ? fmt(target) : "tắt"}</span>
          </div>
          <progress className="progress progress-success mt-2" value={target > 0 ? Math.max(0, pnl) : 0} max={target > 0 ? target : 1} />
          <div className="mt-2 flex justify-between text-sm">
            <span className="text-base-content/60">Tới cắt lỗ</span>
            <span>{lossLimit > 0 ? fmt(lossLimit) : "tắt"}</span>
          </div>
          <progress className="progress progress-error mt-2" value={lossLimit > 0 ? Math.max(0, -pnl) : 0} max={lossLimit > 0 ? lossLimit : 1} />
        </div>
        <div className="card bg-base-100 p-4 shadow-sm">
          <div className="text-sm text-base-content/60">Lệnh</div>
          <div className="text-2xl font-bold">
            {orders.length}
            <span className="text-base font-normal text-base-content/50"> / {maxOrders}</span>
          </div>
          <div className="text-xs text-base-content/60">
            Thắng {wins} · Thua {settled.length - wins}
            {settled.length ? ` · ${Math.round((wins / settled.length) * 100)}%` : ""} · Thua liên tiếp {lossStreak}
          </div>
        </div>
        <div className="card bg-base-100 p-4 shadow-sm">
          <div className="text-sm text-base-content/60">Đã đặt / ngân sách</div>
          <div className="text-2xl font-bold">{fmt(staked)}</div>
          <progress className="progress progress-info mt-2" value={staked} max={dailyBudget || 1} />
          <div className="text-xs text-base-content/60">Ngân sách {fmt(dailyBudget)}</div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* Lệnh */}
        <div className="card bg-base-100 shadow-sm">
          <div className="card-body p-4">
            <h2 className="card-title text-base">Lệnh hôm nay</h2>
            {orders.length === 0 ? (
              <p className="text-sm text-base-content/60">Chưa có lệnh nào.</p>
            ) : (
              <div className="max-h-[520px] overflow-auto">
                <table className="table table-sm table-pin-rows">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Giờ</th>
                      <th>Hướng</th>
                      <th className="text-right">Tiền</th>
                      <th>Kết quả</th>
                      <th className="text-right">Lãi/lỗ</th>
                      <th className="text-right">Số dư sau</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id}>
                        <td>{o.seq}</td>
                        <td className="text-xs">{timeFmt.format(new Date(o.placedAt))}</td>
                        <td>
                          {o.direction === "UP" ? (
                            <span className="flex items-center gap-1 text-success"><TrendingUp className="size-4" /> TĂNG</span>
                          ) : (
                            <span className="flex items-center gap-1 text-error"><TrendingDown className="size-4" /> GIẢM</span>
                          )}
                          {o.ai && (
                            <span className="tooltip tooltip-right" data-tip={`${o.ai.reasoning ?? ""} (${o.ai.model})`}>
                              <span className="badge badge-ghost badge-xs gap-1"><Brain className="size-3" />{Math.round(o.ai.confidence * 100)}%</span>
                            </span>
                          )}
                        </td>
                        <td className="text-right font-mono">{fmt(o.amount)}</td>
                        <td>
                          <ResultBadge result={o.result} error={o.error} />
                          {o.simulated && <span className="badge badge-ghost badge-xs ml-1">giả lập</span>}
                        </td>
                        <td className={`text-right font-mono ${(o.pnl ?? 0) > 0 ? "text-success" : (o.pnl ?? 0) < 0 ? "text-error" : ""}`}>
                          {o.pnl == null ? "—" : signed(o.pnl)}
                        </td>
                        <td className="text-right font-mono text-xs">{fmt(o.balanceAfter)}</td>
                        <td>
                          {o.screenshot && (
                            <button onClick={() => setPreview(o.screenshot)} aria-label="Xem ảnh">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={`/api/files?path=${encodeURIComponent(o.screenshot)}`} alt="" className="h-8 rounded border border-base-300" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Nhật ký */}
        <div className="card bg-base-100 shadow-sm">
          <div className="card-body p-4">
            <h2 className="card-title text-base">Nhật ký</h2>
            <ul className="max-h-[520px] space-y-1.5 overflow-auto text-sm">
              {(run?.logs ?? []).map((l) => (
                <li key={l.id} className={`rounded-field px-2 py-1 ${l.level === "ERROR" ? "bg-error/10 text-error" : l.level === "WARN" ? "bg-warning/10" : ""}`}>
                  <span className="mr-2 font-mono text-xs text-base-content/50">{timeFmt.format(new Date(l.createdAt))}</span>
                  {l.message}
                </li>
              ))}
              {!run && <li className="text-base-content/60">Chưa có nhật ký hôm nay.</li>}
            </ul>
          </div>
        </div>
      </div>

      <dialog className={`modal ${preview ? "modal-open" : ""}`} onClick={() => setPreview(null)}>
        {preview && (
          <div className="modal-box max-w-5xl p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/files?path=${encodeURIComponent(preview)}`} alt="Ảnh chụp lệnh" className="w-full rounded" />
          </div>
        )}
      </dialog>
    </div>
  );
}

function StatusBadge({ status, pendingStart }: { status?: string; pendingStart: boolean }) {
  if (pendingStart) return <span className="badge badge-ghost gap-1"><span className="loading loading-spinner loading-xs" /> Đang khởi động</span>;
  if (status === "RUNNING") return <span className="badge badge-info gap-1"><span className="loading loading-ring loading-xs" /> Đang chạy</span>;
  if (status === "COMPLETED") return <span className="badge badge-success badge-soft">Đã dừng</span>;
  if (status === "STOPPED") return <span className="badge badge-warning badge-soft">Dừng thủ công</span>;
  if (status === "FAILED") return <span className="badge badge-error badge-soft">Lỗi</span>;
  return <span className="badge badge-ghost">Chưa chạy hôm nay</span>;
}

function ResultBadge({ result, error }: { result: string; error: string | null }) {
  if (result === "WIN") return <span className="badge badge-success badge-sm gap-1"><CircleCheck className="size-3" />Thắng</span>;
  if (result === "LOSS") return <span className="badge badge-error badge-sm gap-1"><CircleX className="size-3" />Thua</span>;
  if (result === "DRAW") return <span className="badge badge-ghost badge-sm">Hoà</span>;
  if (result === "PENDING") return <span className="badge badge-info badge-sm gap-1"><span className="loading loading-spinner loading-xs" />Chờ</span>;
  return (
    <span className="tooltip" data-tip={error ?? "Không xác định"}>
      <span className="badge badge-warning badge-sm gap-1"><CircleHelp className="size-3" />Không rõ</span>
    </span>
  );
}
