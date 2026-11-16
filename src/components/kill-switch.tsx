"use client";

import { useRef, useState } from "react";
import { OctagonX } from "lucide-react";
import { killAllBots } from "@/app/(dashboard)/bots/actions";

/** Nút dừng khẩn cấp TẤT CẢ bot — luôn hiện ở sidebar. */
export function KillSwitch() {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<{ pending: boolean; result?: string }>({ pending: false });

  const run = async () => {
    setState({ pending: true });
    try {
      const r = await killAllBots();
      setState({ pending: false, result: r.stopped ? `Đã gửi lệnh dừng khẩn cấp tới ${r.stopped} bot đang chạy.` : "Không có bot nào đang chạy." });
    } catch {
      setState({ pending: false, result: "Không gửi được lệnh dừng — thử lại." });
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-error btn-sm btn-block"
        onClick={() => {
          setState({ pending: false });
          ref.current?.showModal();
        }}
      >
        <OctagonX className="size-4" /> Dừng khẩn cấp
      </button>
      <dialog ref={ref} className="modal">
        <div className="modal-box">
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <OctagonX className="size-5 text-error" /> Dừng khẩn cấp tất cả bot?
          </h3>
          <p className="py-3 text-sm">
            Mọi bot đang chạy sẽ bị ngắt <b>ngay lập tức</b> (kể cả giữa chừng một lệnh) và các lệnh chạy đang chờ sẽ bị huỷ.
            Nếu bot bị ngắt sau khi đã bấm đặt lệnh, lệnh đó sẽ được đánh dấu “không rõ” — hãy kiểm tra lại trên sàn.
          </p>
          {state.result && <div className="alert alert-info alert-soft text-sm">{state.result}</div>}
          <div className="modal-action">
            <form method="dialog">
              <button className="btn btn-ghost">Đóng</button>
            </form>
            {!state.result && (
              <button className="btn btn-error" onClick={run} disabled={state.pending}>
                {state.pending && <span className="loading loading-spinner loading-sm" />} Dừng tất cả
              </button>
            )}
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </>
  );
}
