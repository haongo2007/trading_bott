"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { Bot, Brain, CalendarClock, CircleAlert, Clock, Coins, Compass, Save, ShieldAlert, Target } from "lucide-react";
import { buildCron, describeCron, nextRuns, WEEKDAYS } from "@/lib/schedule";
import {
  DIRECTION_MODE_LABELS, STAKE_MODE_LABELS, clampStake, nextStake,
  type DirectionMode, type OrderOutcome, type StakeMode,
} from "@/lib/strategy";
import { AI_MODELS, parseSequence, type BotFormState, type BotFormValues } from "@/lib/validation/bot";

type Option = { id: string; name: string; note?: string; warn?: string };

type Props = {
  action: (prev: BotFormState, formData: FormData) => Promise<BotFormState>;
  initial: BotFormValues;
  accounts: Option[];
  flows: Option[];
  aiConfigured: boolean;
};

const fmt = (n: number) => Math.round(n).toLocaleString("vi-VN");

export function BotForm({ action, initial, accounts, flows, aiConfigured }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const [v, setV] = useState<BotFormValues>(initial);
  const err = (k: string) => state.errors?.[k]?.[0];
  const s = (k: string) => String(v[k] ?? "");
  const on = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setV((old) => ({ ...old, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));
  const stakeMode = s("stakeMode") as StakeMode;
  const dirMode = s("directionMode") as DirectionMode;
  const dryRun = v.dryRun === true;
  const hasErrors = !!state.errors && Object.values(state.errors).some((x) => x?.length);

  // Xem trước tiền đặt khi thua liên tiếp & mức lỗ tối đa
  const preview = useMemo(() => {
    const cfg = {
      base: Number(s("stake_base")) || 0,
      percent: Number(s("stake_percent")) || 0,
      multiplier: Number(s("stake_multiplier")) || 2,
      maxSteps: s("stake_maxSteps") === "" ? undefined : Number(s("stake_maxSteps")),
      sequence: parseSequence(s("stake_sequence")),
      roundTo: Number(s("stake_roundTo")) || 1000,
    };
    const maxStake = Number(s("maxStake")) || Infinity;
    const budget = Number(s("dailyBudget")) || Infinity;
    const steps = Math.min(Math.max(Number(s("maxConsecutiveLoss")) || 6, 1), 10);
    const assumedBalance = 10_000_000;
    const history: OrderOutcome[] = [];
    const stakes: number[] = [];
    let spent = 0;
    for (let i = 0; i < steps; i++) {
      const raw = nextStake(stakeMode, cfg, history, assumedBalance - spent);
      const a = clampStake(raw, { maxStake, balance: assumedBalance - spent, budgetLeft: budget - spent, lossRoom: null, minStake: cfg.roundTo });
      if (a == null) break;
      stakes.push(a);
      spent += a;
      history.push({ direction: "UP", amount: a, result: "LOSS" });
    }
    return { stakes, worst: spent };
  }, [v]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form action={formAction} className="space-y-6">
      {(state.message || hasErrors) && (
        <div role="alert" className="alert alert-error alert-soft">
          <CircleAlert className="size-5" />
          <span>{state.message ?? "Vui lòng kiểm tra lại các trường được đánh dấu."}</span>
        </div>
      )}

      <Section icon={<Bot className="size-5" />} title="Thông tin chung" desc="Bot dùng tài khoản sàn nào và chạy flow nào cho mỗi lệnh.">
        <Field label="Tên bot" error={err("name")}>
          <input name="name" className={inputCls(err("name"))} value={s("name")} onChange={on("name")} placeholder="VD: Bot sáng — Sàn ABC" />
        </Field>
        <Field label="Tài khoản sàn" error={err("accountId")} hint={accounts.find((a) => a.id === s("accountId"))?.warn}>
          <select name="accountId" className={selectCls(err("accountId"))} value={s("accountId")} onChange={on("accountId")}>
            <option value="">— Chọn tài khoản —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.note ? ` — ${a.note}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Flow đặt lệnh" error={err("flowId")} hint={flows.find((f) => f.id === s("flowId"))?.warn ?? "Flow phải có khối “Đặt lệnh” và kết thúc sau khi phiên có kết quả."}>
          <select name="flowId" className={selectCls(err("flowId"))} value={s("flowId")} onChange={on("flowId")}>
            <option value="">— Chọn flow —</option>
            {flows.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {f.note ? ` — ${f.note}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <label className={`flex cursor-pointer items-start gap-3 rounded-box border p-4 sm:col-span-2 ${dryRun ? "border-success/40 bg-success/5" : "border-warning bg-warning/10"}`}>
          <input type="checkbox" name="dryRun" className="toggle toggle-success mt-0.5" checked={dryRun} onChange={on("dryRun")} />
          <span>
            <span className="block font-semibold">{dryRun ? "Chạy thử (giả lập) — không đặt lệnh thật" : "CHẠY THẬT — đặt lệnh bằng tiền thật"}</span>
            <span className="text-sm text-base-content/70">
              {dryRun
                ? "Bot vẫn mở sàn, nhập tiền, tìm nút đặt lệnh nhưng không bấm. Kết quả thắng/thua được giả lập ngẫu nhiên 50/50 để kiểm tra chiến lược và điều kiện dừng."
                : "Bot sẽ bấm nút đặt lệnh trên sàn. Chỉ bật sau khi đã chạy thử ổn định."}
            </span>
          </span>
        </label>
      </Section>

      <Section icon={<Coins className="size-5" />} title="Vốn & tiền mỗi lệnh" desc="Ngân sách ngày = tổng tiền tối đa được đặt trong ngày.">
        <Field label="Ngân sách ngày" error={err("dailyBudget")}>
          <input name="dailyBudget" type="number" min={0} className={inputCls(err("dailyBudget"))} value={s("dailyBudget")} onChange={on("dailyBudget")} />
        </Field>
        <Field label="Tiền tối đa mỗi lệnh (trần)" error={err("maxStake")}>
          <input name="maxStake" type="number" min={0} className={inputCls(err("maxStake"))} value={s("maxStake")} onChange={on("maxStake")} />
        </Field>
        <Field label="Cách tính tiền" error={err("stakeMode")}>
          <select name="stakeMode" className="select w-full" value={stakeMode} onChange={on("stakeMode")}>
            {Object.entries(STAKE_MODE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {stakeMode !== "PERCENT_BALANCE" && stakeMode !== "SEQUENCE" && (
          <Field label="Tiền gốc mỗi lệnh" error={err("stake_base")}>
            <input name="stake_base" type="number" min={0} className={inputCls(err("stake_base"))} value={s("stake_base")} onChange={on("stake_base")} />
          </Field>
        )}
        {stakeMode === "PERCENT_BALANCE" && (
          <Field label="% số dư mỗi lệnh" error={err("stake_percent")}>
            <input name="stake_percent" type="number" step="0.1" className={inputCls(err("stake_percent"))} value={s("stake_percent")} onChange={on("stake_percent")} />
          </Field>
        )}
        {(stakeMode === "MARTINGALE" || stakeMode === "ANTI_MARTINGALE") && (
          <>
            <Field label={stakeMode === "MARTINGALE" ? "Hệ số nhân khi THUA" : "Hệ số nhân khi THẮNG"} error={err("stake_multiplier")}>
              <input name="stake_multiplier" type="number" step="0.1" className={inputCls(err("stake_multiplier"))} value={s("stake_multiplier")} onChange={on("stake_multiplier")} />
            </Field>
            <Field label="Số lần nhân tối đa" error={err("stake_maxSteps")} hint="Sau số lần này giữ nguyên mức tiền">
              <input name="stake_maxSteps" type="number" className={inputCls(err("stake_maxSteps"))} value={s("stake_maxSteps")} onChange={on("stake_maxSteps")} />
            </Field>
          </>
        )}
        {stakeMode === "SEQUENCE" && (
          <Field label="Dãy tiền" error={err("stake_sequence")} hint="Thua → bước tiếp theo, thắng → về đầu dãy" wide>
            <input name="stake_sequence" className={inputCls(err("stake_sequence"))} value={s("stake_sequence")} onChange={on("stake_sequence")} placeholder="10000, 20000, 40000" />
          </Field>
        )}
        <Field label="Làm tròn tới bội số" error={err("stake_roundTo")}>
          <input name="stake_roundTo" type="number" className={inputCls(err("stake_roundTo"))} value={s("stake_roundTo")} onChange={on("stake_roundTo")} />
        </Field>
        <div className="rounded-box bg-base-200 p-3 text-sm sm:col-span-2">
          <div className="mb-1 font-semibold">Xem trước khi thua liên tiếp</div>
          {preview.stakes.length ? (
            <>
              <div className="font-mono text-xs">{preview.stakes.map(fmt).join(" → ")}</div>
              <div className="mt-1">
                Thua liên tiếp {preview.stakes.length} lệnh sẽ mất tối đa <b className="text-error">{fmt(preview.worst)}</b>
                {stakeMode === "PERCENT_BALANCE" && " (giả định số dư 10.000.000)"}.
              </div>
            </>
          ) : (
            <span className="text-warning">Cấu hình hiện tại không đặt được lệnh nào (kiểm tra ngân sách, trần, tiền gốc).</span>
          )}
        </div>
      </Section>

      <Section icon={<Compass className="size-5" />} title="Hướng lệnh" desc="Bot chọn TĂNG hay GIẢM cho mỗi lệnh như thế nào.">
        <Field label="Cách chọn hướng" wide>
          <select name="directionMode" className="select w-full" value={dirMode} onChange={on("directionMode")}>
            {Object.entries(DIRECTION_MODE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {dirMode === "FIXED" && (
          <Field label="Hướng">
            <DirSelect name="dir_fixed" value={s("dir_fixed")} onChange={on("dir_fixed")} />
          </Field>
        )}
        {(dirMode === "FOLLOW_LAST" || dirMode === "REVERSE_LAST" || dirMode === "RULE") && (
          <Field label="Hướng lệnh đầu tiên" hint="Khi chưa có lịch sử trong ngày">
            <DirSelect name="dir_initial" value={s("dir_initial")} onChange={on("dir_initial")} />
          </Field>
        )}
        {dirMode === "PATTERN" && (
          <Field label="Chuỗi mẫu" error={err("dir_pattern")} hint="Lặp lại theo thứ tự. Chấp nhận UP/DOWN hoặc T/G" wide>
            <input name="dir_pattern" className={inputCls(err("dir_pattern"))} value={s("dir_pattern")} onChange={on("dir_pattern")} />
          </Field>
        )}
        {dirMode === "RULE" && (
          <>
            <Field label="Số phiên cùng kết quả" error={err("dir_streak")}>
              <input name="dir_streak" type="number" min={2} className={inputCls(err("dir_streak"))} value={s("dir_streak")} onChange={on("dir_streak")} />
            </Field>
            <Field label="Khi gặp chuỗi">
              <select name="dir_streakAction" className="select w-full" value={s("dir_streakAction")} onChange={on("dir_streakAction")}>
                <option value="reverse">Đánh ngược chuỗi</option>
                <option value="follow">Đánh theo chuỗi</option>
              </select>
            </Field>
          </>
        )}
        {dirMode === "AI" && (
          <>
            <div className="sm:col-span-2">
              {!aiConfigured && (
                <div className="alert alert-warning alert-soft mb-3 text-sm">
                  <ShieldAlert className="size-4" /> Worker chưa có <code>ANTHROPIC_API_KEY</code> — đặt trong .env của worker trước khi chạy bot AI.
                </div>
              )}
              <div className="alert alert-info alert-soft text-sm">
                <Brain className="size-4" />
                <span>
                  Claude phân tích lịch sử lệnh trong ngày (và các giá trị flow đọc được) để chọn hướng. Kết quả phiên ngắn gần như ngẫu nhiên — AI
                  được yêu cầu báo độ tin cậy thấp khi không thấy lợi thế, và bot sẽ <b>bỏ qua phiên</b> đó. Hãy chạy thử đủ lâu và xem tỉ lệ thắng thực tế
                  trước khi chạy thật.
                </span>
              </div>
            </div>
            <Field label="Model">
              <select name="ai_model" className="select w-full" value={s("ai_model")} onChange={on("ai_model")}>
                {AI_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Mức suy nghĩ (effort)" hint="Thấp = nhanh & rẻ, phù hợp mỗi phiên">
              <select name="ai_effort" className="select w-full" value={s("ai_effort")} onChange={on("ai_effort")}>
                <option value="low">Thấp</option>
                <option value="medium">Trung bình</option>
                <option value="high">Cao</option>
              </select>
            </Field>
            <Field label="Độ tin cậy tối thiểu (%)" error={err("ai_minConfidence")} hint="Thấp hơn → bỏ qua phiên">
              <input name="ai_minConfidence" type="number" min={50} max={100} className={inputCls(err("ai_minConfidence"))} value={s("ai_minConfidence")} onChange={on("ai_minConfidence")} />
            </Field>
            <Field label="Số lệnh gần nhất gửi cho AI" error={err("ai_history")}>
              <input name="ai_history" type="number" min={1} max={100} className={inputCls(err("ai_history"))} value={s("ai_history")} onChange={on("ai_history")} />
            </Field>
            <Field label="Ghi chú thêm cho AI (tuỳ chọn)" wide>
              <textarea name="ai_extraPrompt" rows={2} className="textarea w-full" value={s("ai_extraPrompt")} onChange={on("ai_extraPrompt")} placeholder="VD: Sàn này hay đảo chiều sau 3 phiên cùng màu" />
            </Field>
          </>
        )}
      </Section>

      <Section icon={<Target className="size-5" />} title="Điều kiện dừng" desc="Kiểm tra trước mỗi lệnh. Dừng do các điều kiện này thì hôm nay bot không chạy lại.">
        <Field label="Chốt lời ngày (0 = tắt)" error={err("takeProfitValue")}>
          <div className="join w-full">
            <input name="takeProfitValue" type="number" min={0} className={`${inputCls(err("takeProfitValue"))} join-item`} value={s("takeProfitValue")} onChange={on("takeProfitValue")} />
            <select name="takeProfitType" className="select join-item w-28" value={s("takeProfitType")} onChange={on("takeProfitType")}>
              <option value="AMOUNT">Tiền</option>
              <option value="PERCENT">% số dư</option>
            </select>
          </div>
        </Field>
        <Field label="Cắt lỗ ngày (bắt buộc)" error={err("stopLossValue")}>
          <div className="join w-full">
            <input name="stopLossValue" type="number" min={0} className={`${inputCls(err("stopLossValue"))} join-item`} value={s("stopLossValue")} onChange={on("stopLossValue")} />
            <select name="stopLossType" className="select join-item w-28" value={s("stopLossType")} onChange={on("stopLossType")}>
              <option value="AMOUNT">Tiền</option>
              <option value="PERCENT">% số dư</option>
            </select>
          </div>
        </Field>
        <Field label="Thua liên tiếp tối đa (0 = tắt)" error={err("maxConsecutiveLoss")}>
          <input name="maxConsecutiveLoss" type="number" min={0} className={inputCls(err("maxConsecutiveLoss"))} value={s("maxConsecutiveLoss")} onChange={on("maxConsecutiveLoss")} />
        </Field>
        <Field label="Số lệnh tối đa mỗi ngày" error={err("maxOrdersPerDay")}>
          <input name="maxOrdersPerDay" type="number" min={1} className={inputCls(err("maxOrdersPerDay"))} value={s("maxOrdersPerDay")} onChange={on("maxOrdersPerDay")} />
        </Field>
        <p className="text-xs text-base-content/60 sm:col-span-2">
          % được tính theo số dư lúc bắt đầu phiên đầu tiên trong ngày và giữ nguyên cả ngày. Bot cũng tự giảm tiền lệnh để một lệnh thua không làm vượt mức cắt lỗ.
        </p>
      </Section>

      <ScheduleSection v={v} setV={setV} err={err} />

      <Section icon={<Clock className="size-5" />} title="Nhịp chạy & khung giờ" desc="Ngoài khung giờ bot không khởi động; đang chạy mà hết khung giờ thì tự dừng.">
        <Field label="Bắt đầu được phép (HH:MM)" error={err("windowStart")}>
          <input name="windowStart" className={inputCls(err("windowStart"))} value={s("windowStart")} onChange={on("windowStart")} placeholder="09:00" />
        </Field>
        <Field label="Kết thúc (HH:MM)" error={err("windowEnd")} hint="Để trống = không giới hạn">
          <input name="windowEnd" className={inputCls(err("windowEnd"))} value={s("windowEnd")} onChange={on("windowEnd")} placeholder="22:00" />
        </Field>
        <Field label="Múi giờ" error={err("timezone")}>
          <input name="timezone" className={inputCls(err("timezone"))} value={s("timezone")} onChange={on("timezone")} />
        </Field>
        <Field label="Nghỉ giữa 2 lệnh (giây)" error={err("roundDelaySec")}>
          <input name="roundDelaySec" type="number" min={0} className={inputCls(err("roundDelaySec"))} value={s("roundDelaySec")} onChange={on("roundDelaySec")} />
        </Field>
        <Field label="Chờ thêm trước khi đọc kết quả (giây)" error={err("settleDelaySec")} hint="Sau khi flow kết thúc, đợi sàn cập nhật số dư">
          <input name="settleDelaySec" type="number" min={0} className={inputCls(err("settleDelaySec"))} value={s("settleDelaySec")} onChange={on("settleDelaySec")} />
        </Field>
        <Field label="Tỉ lệ trả thưởng khi thắng (%)" error={err("payoutPercent")} hint="Dùng cho chạy thử (giả lập)">
          <input name="payoutPercent" type="number" step="0.1" className={inputCls(err("payoutPercent"))} value={s("payoutPercent")} onChange={on("payoutPercent")} />
        </Field>
      </Section>

      <div className="sticky bottom-4 z-10 flex items-center justify-end gap-2 rounded-box border border-base-300 bg-base-100/90 p-3 shadow-lg backdrop-blur">
        <Link href="/bots" className="btn btn-ghost">
          Huỷ
        </Link>
        <button disabled={pending} className={`btn ${dryRun ? "btn-primary" : "btn-warning"}`}>
          {pending ? <span className="loading loading-spinner loading-sm" /> : <Save className="size-4" />}
          {dryRun ? "Lưu bot" : "Lưu bot (chạy thật)"}
        </button>
      </div>
    </form>
  );
}

function ScheduleSection({
  v, setV, err,
}: {
  v: BotFormValues;
  setV: React.Dispatch<React.SetStateAction<BotFormValues>>;
  err: (k: string) => string | undefined;
}) {
  const [now] = useState(() => new Date());
  const s = (k: string) => String(v[k] ?? "");
  const enabled = v.enabled === true;
  const mode = s("scheduleMode") === "advanced" ? "advanced" : "simple";
  const days = s("schedule_days").split(",").filter(Boolean).map(Number);
  const tz = s("timezone") || "Asia/Ho_Chi_Minh";

  let cron: string | null = null;
  try {
    cron = mode === "advanced" ? s("cron_advanced").trim() || null : buildCron(s("schedule_time"), days);
  } catch {
    cron = null;
  }
  const upcoming = cron ? nextRuns(cron, tz, now, 3) : [];
  const fmtRun = new Intl.DateTimeFormat("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: tz });

  const toggleDay = (d: number) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
    setV((o) => ({ ...o, schedule_days: next.join(",") }));
  };

  return (
    <Section icon={<CalendarClock className="size-5" />} title="Lịch tự chạy" desc="Worker tự khởi động bot theo lịch (múi giờ của bot). Mất kết nối đúng giờ thì vẫn chạy bù trong 30 phút.">
      <label className={`flex cursor-pointer items-start gap-3 rounded-box border p-4 sm:col-span-2 ${enabled ? "border-primary bg-primary/5" : "border-base-300"}`}>
        <input
          type="checkbox"
          name="enabled"
          className="toggle toggle-primary mt-0.5"
          checked={enabled}
          onChange={(e) => setV((o) => ({ ...o, enabled: e.target.checked }))}
        />
        <span>
          <span className="block font-semibold">{enabled ? "Đang bật lịch tự chạy" : "Tắt — chỉ chạy khi bấm thủ công"}</span>
          <span className="text-sm text-base-content/60">Bật/đổi lịch chỉ áp dụng cho các mốc từ bây giờ trở đi.</span>
        </span>
      </label>

      <div className="sm:col-span-2">
        <input type="hidden" name="scheduleMode" value={mode} />
        <div role="tablist" className="tabs-box tabs tabs-sm w-fit">
          <button type="button" role="tab" className={`tab ${mode === "simple" ? "tab-active" : ""}`} onClick={() => setV((o) => ({ ...o, scheduleMode: "simple" }))}>
            Giờ & ngày
          </button>
          <button type="button" role="tab" className={`tab ${mode === "advanced" ? "tab-active" : ""}`} onClick={() => setV((o) => ({ ...o, scheduleMode: "advanced" }))}>
            Cron nâng cao
          </button>
        </div>
      </div>

      {mode === "simple" ? (
        <>
          <Field label="Giờ chạy" error={err("schedule_time")}>
            <input
              type="time"
              name="schedule_time"
              className={inputCls(err("schedule_time"))}
              value={s("schedule_time")}
              onChange={(e) => setV((o) => ({ ...o, schedule_time: e.target.value }))}
            />
          </Field>
          <Field label="Các ngày trong tuần" error={err("schedule_days")}>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {WEEKDAYS.map((w) => (
                <label key={w.value} className={`btn btn-sm ${days.includes(w.value) ? "btn-primary" : "btn-outline"}`}>
                  <input type="checkbox" name="schedule_days" value={w.value} className="hidden" checked={days.includes(w.value)} onChange={() => toggleDay(w.value)} />
                  {w.short}
                </label>
              ))}
            </div>
          </Field>
        </>
      ) : (
        <Field label="Biểu thức cron (phút giờ ngày tháng thứ)" error={err("cron_advanced")} hint="VD: 0 9,14 * * 1-5 = 9h và 14h từ T2 đến T6" wide>
          <input
            name="cron_advanced"
            className={`${inputCls(err("cron_advanced"))} font-mono`}
            value={s("cron_advanced")}
            onChange={(e) => setV((o) => ({ ...o, cron_advanced: e.target.value }))}
          />
        </Field>
      )}

      <div className="rounded-box bg-base-200 p-3 text-sm sm:col-span-2">
        {cron && upcoming.length ? (
          <>
            <span className="font-semibold">{describeCron(cron)}</span> · Lần chạy tới: {upcoming.map((d) => fmtRun.format(d)).join(" · ")}
          </>
        ) : (
          <span className="text-warning">Lịch chưa hợp lệ.</span>
        )}
      </div>
    </Section>
  );
}

const inputCls = (e?: string) => `input w-full ${e ? "input-error" : ""}`;
const selectCls = (e?: string) => `select w-full ${e ? "select-error" : ""}`;

function DirSelect({ name, value, onChange }: { name: string; value: string; onChange: React.ChangeEventHandler<HTMLSelectElement> }) {
  return (
    <select name={name} className="select w-full" value={value} onChange={onChange}>
      <option value="UP">▲ TĂNG (UP)</option>
      <option value="DOWN">▼ GIẢM (DOWN)</option>
    </select>
  );
}

function Section({ icon, title, desc, children }: { icon: React.ReactNode; title: string; desc?: string; children: React.ReactNode }) {
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
        <div className="grid flex-1 content-start gap-x-4 sm:grid-cols-2">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, error, hint, wide, children }: { label: string; error?: string; hint?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <fieldset className={`fieldset ${wide ? "sm:col-span-2" : ""}`}>
      <legend className="fieldset-legend">{label}</legend>
      {children}
      {error ? <p className="label text-error">{error}</p> : hint && <p className="label whitespace-normal">{hint}</p>}
    </fieldset>
  );
}
