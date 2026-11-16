"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, CircleX, PlugZap, X } from "lucide-react";
import { getCommandStatus, requestTestLogin, type CommandView } from "./worker-actions";

type State =
  | { phase: "idle" }
  | { phase: "running"; commandId: string; view?: CommandView }
  | { phase: "done"; ok: boolean; message: string; detail?: string };

export function TestLoginButton({ accountId, disabled }: { accountId: string; disabled?: boolean }) {
  const [state, setState] = useState<State>({ phase: "idle" });
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function poll(commandId: string) {
    const view = await getCommandStatus(commandId);
    if (!view) return setState({ phase: "done", ok: false, message: "Lệnh không tồn tại" });
    if (view.status === "DONE" || view.status === "FAILED" || view.status === "CANCELLED") {
      const r = view.result;
      setState(
        r?.ok
          ? { phase: "done", ok: true, message: r.via === "NONE" ? "Mở trang giao dịch thành công (không cần đăng nhập)" : `Đăng nhập thành công (${r.via === "SESSION" ? "phiên đã lưu" : "form"})`, detail: r.balanceText ? `Số dư: ${r.balanceText}` : undefined }
          : { phase: "done", ok: false, message: r?.error ?? "Đăng nhập thất bại", detail: r?.screenshot ? `Ảnh chụp lỗi: ${r.screenshot}` : undefined },
      );
      router.refresh();
      return;
    }
    setState({ phase: "running", commandId, view });
    timer.current = setTimeout(() => poll(commandId), 1500);
  }

  async function start() {
    const res = await requestTestLogin(accountId);
    if (!res.commandId) return setState({ phase: "done", ok: false, message: res.error ?? "Không tạo được lệnh" });
    setState({ phase: "running", commandId: res.commandId });
    poll(res.commandId);
  }

  const running = state.phase === "running";
  const workerSlow = running && state.view?.status === "PENDING" && state.view.ageSec > 8;

  return (
    <>
      <button type="button" className="btn btn-sm btn-outline" onClick={start} disabled={running || disabled}>
        {running ? <span className="loading loading-spinner loading-xs" /> : <PlugZap className="size-4" />}
        {running ? "Đang kiểm tra..." : "Kiểm tra đăng nhập"}
      </button>

      {(state.phase === "done" || workerSlow) && (
        <div className="toast toast-end toast-bottom z-50">
          {workerSlow ? (
            <div className="alert alert-warning">
              <span>Lệnh đang chờ worker. Worker đã chạy chưa? (<code>npm run worker</code>)</span>
            </div>
          ) : (
            state.phase === "done" && (
              <div className={`alert ${state.ok ? "alert-success" : "alert-error"} max-w-md items-start`}>
                {state.ok ? <CircleCheck className="size-5" /> : <CircleX className="size-5" />}
                <div className="min-w-0">
                  <div className="font-semibold">{state.message}</div>
                  {state.detail && <div className="text-sm break-all opacity-80">{state.detail}</div>}
                </div>
                <button className="btn btn-ghost btn-xs btn-square" onClick={() => setState({ phase: "idle" })} aria-label="Đóng">
                  <X className="size-4" />
                </button>
              </div>
            )
          )}
        </div>
      )}
    </>
  );
}
