"use client";

import { useActionState, useRef } from "react";
import { Trash2, TriangleAlert } from "lucide-react";
import type { AccountFormState } from "@/lib/validation/account";
import { deleteAccount } from "./actions";

export function DeleteAccountModal({ id, name }: { id: string; name: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<AccountFormState>(() => deleteAccount(id), {});

  return (
    <>
      <button type="button" className="btn btn-error btn-outline btn-sm" onClick={() => ref.current?.showModal()}>
        <Trash2 className="size-4" /> Xoá
      </button>
      <dialog ref={ref} className="modal">
        <div className="modal-box">
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <TriangleAlert className="size-5 text-error" /> Xoá tài khoản?
          </h3>
          <p className="py-4">
            Tài khoản <b>{name}</b> và phiên đăng nhập đã lưu sẽ bị xoá vĩnh viễn. Không thể hoàn tác.
          </p>
          {state.message && <div className="alert alert-error alert-soft mb-2 text-sm">{state.message}</div>}
          <div className="modal-action">
            <form method="dialog">
              <button className="btn btn-ghost">Huỷ</button>
            </form>
            <form action={action}>
              <button className="btn btn-error" disabled={pending}>
                {pending && <span className="loading loading-spinner loading-sm" />}
                Xoá vĩnh viễn
              </button>
            </form>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </>
  );
}
