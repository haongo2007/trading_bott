"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";
import { createFlow } from "./actions";

export function NewFlowButton({ small }: { small?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className={`btn btn-primary ${small ? "btn-sm" : ""}`} onClick={() => ref.current?.showModal()}>
        <Plus className="size-4" /> Tạo flow
      </button>
      <dialog ref={ref} className="modal">
        <div className="modal-box">
          <h3 className="text-lg font-bold">Tạo flow mới</h3>
          <form action={createFlow} className="mt-4 space-y-4">
            <fieldset className="fieldset">
              <legend className="fieldset-legend">Tên flow</legend>
              <input name="name" className="input w-full" placeholder="VD: Đặt lệnh TĂNG trên Sàn ABC" required maxLength={100} autoFocus />
            </fieldset>
            <div className="modal-action">
              <button type="button" className="btn btn-ghost" onClick={() => ref.current?.close()}>
                Huỷ
              </button>
              <Submit />
            </div>
          </form>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-primary" disabled={pending}>
      {pending && <span className="loading loading-spinner loading-sm" />} Tạo & mở trình soạn thảo
    </button>
  );
}
