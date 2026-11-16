"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { CircleAlert, Cookie, Globe, KeyRound, Monitor, MousePointerClick, Save, ShieldCheck, StickyNote, User } from "lucide-react";
import type { AccountFormState } from "@/lib/validation/account";
import { PasswordInput } from "@/components/password-input";

export type AccountFormValues = {
  name: string;
  platformName: string;
  loginUrl: string;
  tradeUrl: string;
  username: string;
  loginMethod: "FORM" | "SESSION";
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  successSelector: string;
  balanceSelector: string;
  currency: string;
  viewportWidth: number;
  viewportHeight: number;
  locale: string;
  timezone: string;
  loginTimeoutSec: number;
  maxLoginRetries: number;
  notes: string;
  disabled: boolean;
};

export const emptyAccount: AccountFormValues = {
  name: "",
  platformName: "",
  loginUrl: "",
  tradeUrl: "",
  username: "",
  loginMethod: "FORM",
  usernameSelector: "",
  passwordSelector: "",
  submitSelector: "",
  successSelector: "",
  balanceSelector: "",
  currency: "VND",
  viewportWidth: 1366,
  viewportHeight: 768,
  locale: "vi-VN",
  timezone: "Asia/Ho_Chi_Minh",
  loginTimeoutSec: 30,
  maxLoginRetries: 2,
  notes: "",
  disabled: false,
};

type Props = {
  action: (prev: AccountFormState, formData: FormData) => Promise<AccountFormState>;
  initial: AccountFormValues;
  isEdit?: boolean;
};

export function AccountForm({ action, initial, isEdit }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const [method, setMethod] = useState(initial.loginMethod);
  const err = (k: string) => state.errors?.[k as keyof typeof state.errors]?.[0];
  const hasErrors = !!state.errors && Object.keys(state.errors).length > 0;

  return (
    <form action={formAction} className="space-y-6">
      {(state.message || hasErrors) && (
        <div role="alert" className="alert alert-error alert-soft">
          <CircleAlert className="size-5" />
          <span>{state.message ?? "Vui lòng kiểm tra lại các trường được đánh dấu."}</span>
        </div>
      )}

      <Section icon={<Globe className="size-5" />} title="Thông tin chung" desc="Tên gợi nhớ và địa chỉ của nền tảng giao dịch.">
        <Field label="Tên gợi nhớ" name="name" placeholder="VD: Tài khoản chính" defaultValue={initial.name} error={err("name")} />
        <Field label="Nền tảng" name="platformName" placeholder="VD: Sàn ABC" defaultValue={initial.platformName} error={err("platformName")} />
        <Field label="URL đăng nhập" name="loginUrl" type="url" placeholder="https://..." defaultValue={initial.loginUrl} error={err("loginUrl")} />
        <Field label="URL trang đặt lệnh" name="tradeUrl" type="url" placeholder="https://..." defaultValue={initial.tradeUrl} error={err("tradeUrl")} />
        <Field label="Đơn vị tiền" name="currency" defaultValue={initial.currency} error={err("currency")} />
      </Section>

      <Section
        icon={<KeyRound className="size-5" />}
        title="Thông tin đăng nhập"
        desc="Được mã hoá AES-256-GCM trước khi lưu. Mật khẩu không bao giờ được gửi lại trình duyệt."
      >
        <fieldset className="fieldset">
          <legend className="fieldset-legend">Tên đăng nhập</legend>
          <label className={`input w-full ${err("username") ? "input-error" : ""}`}>
            <User className="size-4 opacity-50" />
            <input name="username" autoComplete="off" defaultValue={initial.username} className="grow" />
          </label>
          {err("username") && <p className="label text-error">{err("username")}</p>}
        </fieldset>
        <fieldset className="fieldset">
          <legend className="fieldset-legend">Mật khẩu</legend>
          <PasswordInput
            name="password"
            autoComplete="new-password"
            placeholder={isEdit ? "Để trống nếu không đổi" : ""}
            invalid={!!err("password")}
          />
          {err("password") && <p className="label text-error">{err("password")}</p>}
        </fieldset>

        <div className="sm:col-span-2">
          <div className="fieldset-legend mb-2 text-xs font-semibold">Cách đăng nhập</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <MethodCard
              value="FORM"
              current={method}
              onChange={setMethod}
              icon={<MousePointerClick className="size-5" />}
              title="Tự điền form"
              desc="Bot tự nhập tên đăng nhập, mật khẩu và bấm nút đăng nhập."
            />
            <MethodCard
              value="SESSION"
              current={method}
              onChange={setMethod}
              icon={<Cookie className="size-5" />}
              title="Phiên đã lưu"
              desc="Đăng nhập tay 1 lần qua canvas, bot dùng lại cookie phiên."
            />
          </div>
        </div>
      </Section>

      <Section
        icon={<MousePointerClick className="size-5" />}
        title="Selector trang web"
        desc="Nên chọn bằng “Trình duyệt trực tiếp” (click vào phần tử). Có thể nhập tay CSS selector hoặc selector Playwright, VD: #username, button:has-text(&quot;Đăng nhập&quot;)."
      >
        {method === "FORM" && (
          <>
            <Field mono label="Ô tên đăng nhập" name="usernameSelector" placeholder="#username" defaultValue={initial.usernameSelector} error={err("usernameSelector")} />
            <Field mono label="Ô mật khẩu" name="passwordSelector" placeholder="input[type=password]" defaultValue={initial.passwordSelector} error={err("passwordSelector")} />
            <Field mono label="Nút đăng nhập" name="submitSelector" placeholder="button[type=submit]" defaultValue={initial.submitSelector} error={err("submitSelector")} />
          </>
        )}
        <Field mono label="Dấu hiệu đã đăng nhập" hint="Phần tử chỉ xuất hiện sau khi đăng nhập" name="successSelector" placeholder=".user-avatar" defaultValue={initial.successSelector} error={err("successSelector")} />
        <Field mono label="Vị trí hiển thị số dư" name="balanceSelector" placeholder=".balance-amount" defaultValue={initial.balanceSelector} error={err("balanceSelector")} />
      </Section>

      <Section icon={<Monitor className="size-5" />} title="Trình duyệt" desc="Cấu hình phiên trình duyệt bot dùng để truy cập nền tảng.">
        <Field label="Chiều rộng viewport (px)" name="viewportWidth" type="number" defaultValue={initial.viewportWidth} error={err("viewportWidth")} />
        <Field label="Chiều cao viewport (px)" name="viewportHeight" type="number" defaultValue={initial.viewportHeight} error={err("viewportHeight")} />
        <Field label="Ngôn ngữ (locale)" name="locale" defaultValue={initial.locale} error={err("locale")} />
        <Field label="Múi giờ" name="timezone" defaultValue={initial.timezone} error={err("timezone")} />
        <Field label="Timeout đăng nhập (giây)" name="loginTimeoutSec" type="number" defaultValue={initial.loginTimeoutSec} error={err("loginTimeoutSec")} />
        <Field label="Số lần thử đăng nhập lại" name="maxLoginRetries" type="number" defaultValue={initial.maxLoginRetries} error={err("maxLoginRetries")} />
      </Section>

      <Section icon={<StickyNote className="size-5" />} title="Khác" desc="Ghi chú nội bộ và trạng thái sử dụng.">
        <fieldset className="fieldset sm:col-span-2">
          <legend className="fieldset-legend">Ghi chú</legend>
          <textarea name="notes" defaultValue={initial.notes} rows={3} className="textarea w-full" />
        </fieldset>
        <label className="flex cursor-pointer items-start gap-3 rounded-box border border-base-300 p-4 sm:col-span-2">
          <input type="checkbox" name="disabled" defaultChecked={initial.disabled} className="toggle toggle-warning mt-0.5" />
          <span>
            <span className="block font-medium">Tạm khoá tài khoản</span>
            <span className="text-sm text-base-content/60">Bot sẽ không dùng tài khoản này cho tới khi mở lại.</span>
          </span>
        </label>
      </Section>

      <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-box border border-base-300 bg-base-100/90 p-3 shadow-lg backdrop-blur">
        <span className="hidden items-center gap-2 text-sm text-base-content/60 sm:flex">
          <ShieldCheck className="size-4 text-success" /> Dữ liệu nhạy cảm được mã hoá
        </span>
        <div className="ml-auto flex gap-2">
          <Link href="/accounts" className="btn btn-ghost">
            Huỷ
          </Link>
          <button disabled={pending} className="btn btn-primary">
            {pending ? <span className="loading loading-spinner loading-sm" /> : <Save className="size-4" />}
            {pending ? "Đang lưu..." : "Lưu tài khoản"}
          </button>
        </div>
      </div>
    </form>
  );
}

function Section({
  icon,
  title,
  desc,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card bg-base-100 shadow-sm">
      <div className="card-body gap-4 lg:flex-row lg:gap-8">
        <div className="lg:w-64 lg:shrink-0">
          <h2 className="card-title text-base">
            <span className="text-primary">{icon}</span>
            {title}
          </h2>
          {desc && <p className="mt-1 text-sm text-base-content/60">{desc}</p>}
        </div>
        <div className="grid flex-1 gap-x-4 sm:grid-cols-2">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  mono,
  ...props
}: { label: string; hint?: string; error?: string; mono?: boolean } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <fieldset className="fieldset">
      <legend className="fieldset-legend">{label}</legend>
      <input {...props} className={`input w-full ${mono ? "font-mono text-sm" : ""} ${error ? "input-error" : ""}`} />
      {error ? <p className="label text-error">{error}</p> : hint && <p className="label">{hint}</p>}
    </fieldset>
  );
}

function MethodCard({
  value,
  current,
  onChange,
  icon,
  title,
  desc,
}: {
  value: "FORM" | "SESSION";
  current: string;
  onChange: (v: "FORM" | "SESSION") => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <label className="flex cursor-pointer gap-3 rounded-box border border-base-300 p-4 transition has-checked:border-primary has-checked:bg-primary/5">
      <input
        type="radio"
        name="loginMethod"
        value={value}
        checked={current === value}
        onChange={() => onChange(value)}
        className="radio radio-primary radio-sm mt-0.5"
      />
      <span>
        <span className="flex items-center gap-2 font-medium">
          {icon}
          {title}
        </span>
        <span className="text-sm text-base-content/60">{desc}</span>
      </span>
    </label>
  );
}
