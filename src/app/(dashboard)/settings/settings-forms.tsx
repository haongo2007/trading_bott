"use client";

import { useActionState, useState } from "react";
import { CircleAlert, CircleCheck, Search, Send } from "lucide-react";
import type { NotifyEvent } from "@/lib/settings";
import { PasswordInput } from "@/components/password-input";
import { lookupTelegramChats, saveStorageSettings, saveTelegramSettings, sendTelegramTest, type SettingsState } from "./actions";

type TelegramInitial = {
  enabled: boolean;
  hasToken: boolean;
  chatId: string;
  events: NotifyEvent[];
  summaryTime: string;
  timezone: string;
};

export function TelegramForm({
  initial,
  readOnly,
  eventLabels,
}: {
  initial: TelegramInitial;
  readOnly: boolean;
  eventLabels: Record<NotifyEvent, string>;
}) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveTelegramSettings, {});
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState(initial.chatId);
  const [test, setTest] = useState<SettingsState | null>(null);
  const [chats, setChats] = useState<{ id: string; name: string }[] | null>(null);
  const [busy, setBusy] = useState<"test" | "lookup" | null>(null);
  const err = (k: string) => state.errors?.[k]?.[0];

  return (
    <form action={action} className="space-y-4">
      <fieldset disabled={readOnly} className="space-y-4">
        <label className="flex cursor-pointer items-center gap-3">
          <input type="checkbox" name="enabled" className="toggle toggle-primary" defaultChecked={initial.enabled} />
          <span className="font-medium">Bật thông báo Telegram</span>
        </label>

        <div className="grid gap-x-4 sm:grid-cols-2">
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Bot token</legend>
            <PasswordInput
              name="botToken"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={initial.hasToken ? "Đã lưu — để trống nếu không đổi" : "123456789:AA…"}
              autoComplete="off"
              invalid={!!err("botToken")}
            />
            <p className={`label whitespace-normal ${err("botToken") ? "text-error" : ""}`}>
              {err("botToken") ?? "Tạo bot qua @BotFather trên Telegram → /newbot → nhận token."}
            </p>
          </fieldset>
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Chat ID</legend>
            <div className="join w-full">
              <input name="chatId" className={`input join-item w-full ${err("chatId") ? "input-error" : ""}`} value={chatId} onChange={(e) => setChatId(e.target.value)} />
              <button
                type="button"
                className="btn join-item"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy("lookup");
                  const r = await lookupTelegramChats(token).finally(() => setBusy(null));
                  setChats(r.ok ? r.chats : []);
                  if (!r.ok) setTest({ ok: false, message: r.error });
                }}
              >
                {busy === "lookup" ? <span className="loading loading-spinner loading-xs" /> : <Search className="size-4" />} Tìm
              </button>
            </div>
            <p className={`label whitespace-normal ${err("chatId") ? "text-error" : ""}`}>
              {err("chatId") ?? "Nhắn 1 tin bất kỳ cho bot của bạn (hoặc thêm bot vào nhóm), rồi bấm Tìm."}
            </p>
            {chats && (
              <div className="mt-1 space-y-1">
                {chats.length === 0 && <p className="text-xs text-warning">Chưa thấy chat nào — hãy nhắn cho bot trước.</p>}
                {chats.map((c) => (
                  <button key={c.id} type="button" className="btn btn-xs btn-ghost" onClick={() => setChatId(c.id)}>
                    {c.name} <code>{c.id}</code>
                  </button>
                ))}
              </div>
            )}
          </fieldset>
        </div>

        <fieldset className="fieldset">
          <legend className="fieldset-legend">Gửi thông báo khi</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.entries(eventLabels) as [NotifyEvent, string][]).map(([k, label]) => (
              <label key={k} className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" name="events" value={k} className="checkbox checkbox-sm" defaultChecked={initial.events.includes(k)} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-x-4 sm:grid-cols-2">
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Giờ gửi tổng kết ngày</legend>
            <input type="time" name="summaryTime" className="input w-full" defaultValue={initial.summaryTime} />
          </fieldset>
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Múi giờ</legend>
            <input name="timezone" className="input w-full" defaultValue={initial.timezone} />
          </fieldset>
        </div>
      </fieldset>

      {(state.message || test?.message) && (
        <div role="alert" className={`alert alert-soft text-sm ${(test ?? state).ok ? "alert-success" : "alert-error"}`}>
          {(test ?? state).ok ? <CircleCheck className="size-4" /> : <CircleAlert className="size-4" />}
          <span>{test?.message ?? state.message}</span>
        </div>
      )}

      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={pending} onClick={() => setTest(null)}>
            {pending && <span className="loading loading-spinner loading-sm" />} Lưu
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy !== null}
            onClick={async () => {
              setBusy("test");
              setTest(await sendTelegramTest(token, chatId).finally(() => setBusy(null)));
            }}
          >
            {busy === "test" ? <span className="loading loading-spinner loading-sm" /> : <Send className="size-4" />} Gửi thử
          </button>
        </div>
      )}
    </form>
  );
}

export function StorageForm({ retentionDays, readOnly }: { retentionDays: number; readOnly: boolean }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveStorageSettings, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <fieldset className="fieldset" disabled={readOnly}>
        <legend className="fieldset-legend">Giữ ảnh chụp màn hình (ngày)</legend>
        <input name="retentionDays" type="number" min={1} max={365} className="input w-40" defaultValue={retentionDays} />
        {state.errors?.retentionDays && <p className="label text-error">{state.errors.retentionDays[0]}</p>}
      </fieldset>
      {!readOnly && (
        <button className="btn" disabled={pending}>
          Lưu
        </button>
      )}
      {state.ok && <span className="text-sm text-success">{state.message}</span>}
    </form>
  );
}
