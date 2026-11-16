"use client";

import { useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";

type Props = React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

export function PasswordInput({ invalid, className, ...props }: Props) {
  const [show, setShow] = useState(false);
  return (
    <label className={`input w-full ${invalid ? "input-error" : ""} ${className ?? ""}`}>
      <Lock className="size-4 opacity-50" />
      <input {...props} type={show ? "text" : "password"} className="grow" />
      <button
        type="button"
        className="btn btn-ghost btn-xs btn-square"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </label>
  );
}
