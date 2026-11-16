"use client";

import { useActionState } from "react";
import { Bot, CircleAlert, LogIn, Mail } from "lucide-react";
import { PasswordInput } from "@/components/password-input";
import { login } from "./actions";

export function LoginForm({ callbackUrl }: { callbackUrl?: string }) {
  const [error, action, pending] = useActionState(login, undefined);
  return (
    <div className="card w-full max-w-sm bg-base-100 shadow-xl">
      <form action={action} className="card-body gap-4">
        <div className="mb-2 flex flex-col items-center text-center">
          <div className="mb-3 grid size-12 place-items-center rounded-box bg-primary text-primary-content">
            <Bot className="size-6" />
          </div>
          <h1 className="text-xl font-bold">Đăng nhập Bot Trading</h1>
          <p className="text-sm text-base-content/60">Bảng điều khiển bot giao dịch tự động</p>
        </div>

        <input type="hidden" name="callbackUrl" value={callbackUrl ?? "/overview"} />

        <fieldset className="fieldset">
          <legend className="fieldset-legend">Email</legend>
          <label className="input w-full">
            <Mail className="size-4 opacity-50" />
            <input name="email" type="email" required autoComplete="email" placeholder="admin@example.com" className="grow" />
          </label>
        </fieldset>
        <fieldset className="fieldset">
          <legend className="fieldset-legend">Mật khẩu</legend>
          <PasswordInput name="password" required autoComplete="current-password" placeholder="••••••••" />
        </fieldset>

        {error && (
          <div role="alert" className="alert alert-error alert-soft py-2 text-sm">
            <CircleAlert className="size-4" />
            <span>{error}</span>
          </div>
        )}

        <button disabled={pending} className="btn btn-primary btn-block mt-2">
          {pending ? <span className="loading loading-spinner loading-sm" /> : <LogIn className="size-4" />}
          {pending ? "Đang đăng nhập..." : "Đăng nhập"}
        </button>
      </form>
    </div>
  );
}
