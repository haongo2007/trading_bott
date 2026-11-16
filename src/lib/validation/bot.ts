import { z } from "zod";
import { isValidHHMM, type DirectionConfig, type Dir, type StakeConfig } from "@/lib/strategy";
import { buildCron, parseSimpleCron, validateCron } from "@/lib/schedule";

export const AI_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 — mặc định, phân tích kỹ nhất" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 — cân bằng tốc độ/chi phí" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 — nhanh, rẻ nhất" },
] as const;

const opt = <T extends z.ZodType>(s: T) => z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : v), s.optional());
const money = z.coerce.number().min(0).max(1e13);
const checkbox = z.preprocess((v) => v === "on" || v === true || v === "true", z.boolean());

export const botFormSchema = z
  .object({
    name: z.string().trim().min(1, "Bắt buộc").max(100),
    accountId: z.string().min(1, "Chọn tài khoản sàn"),
    flowId: z.string().min(1, "Chọn flow đặt lệnh"),
    dryRun: checkbox,

    dailyBudget: money.positive("Phải lớn hơn 0"),
    maxStake: money.positive("Phải lớn hơn 0"),
    stakeMode: z.enum(["FIXED", "PERCENT_BALANCE", "MARTINGALE", "ANTI_MARTINGALE", "SEQUENCE"]),
    stake_base: opt(money.positive("Phải lớn hơn 0")),
    stake_percent: opt(z.coerce.number().min(0.01).max(100)),
    stake_multiplier: opt(z.coerce.number().min(1).max(10)),
    stake_maxSteps: opt(z.coerce.number().int().min(0).max(20)),
    stake_sequence: opt(z.string().max(500)),
    stake_roundTo: opt(money.positive()),

    directionMode: z.enum(["FIXED", "FOLLOW_LAST", "REVERSE_LAST", "PATTERN", "RANDOM", "RULE", "AI"]),
    dir_fixed: opt(z.enum(["UP", "DOWN"])),
    dir_initial: opt(z.enum(["UP", "DOWN"])),
    dir_pattern: opt(z.string().max(500)),
    dir_streak: opt(z.coerce.number().int().min(2).max(20)),
    dir_streakAction: opt(z.enum(["reverse", "follow"])),
    ai_model: opt(z.enum(AI_MODELS.map((m) => m.id) as [string, ...string[]])),
    ai_effort: opt(z.enum(["low", "medium", "high"])),
    ai_minConfidence: opt(z.coerce.number().min(50).max(100)),
    ai_history: opt(z.coerce.number().int().min(1).max(100)),
    ai_extraPrompt: opt(z.string().max(2000)),

    takeProfitType: z.enum(["AMOUNT", "PERCENT"]),
    takeProfitValue: money,
    stopLossType: z.enum(["AMOUNT", "PERCENT"]),
    stopLossValue: money.positive("Bắt buộc đặt cắt lỗ (> 0)"),
    maxConsecutiveLoss: z.coerce.number().int().min(0).max(100),
    maxOrdersPerDay: z.coerce.number().int().min(1).max(1000),
    windowStart: opt(z.string().refine(isValidHHMM, "Dạng HH:MM")),
    windowEnd: opt(z.string().refine(isValidHHMM, "Dạng HH:MM")),
    timezone: z.string().min(1).max(64),
    roundDelaySec: z.coerce.number().int().min(0).max(3600),
    settleDelaySec: z.coerce.number().int().min(0).max(600),
    payoutPercent: z.coerce.number().min(1).max(500),

    enabled: checkbox,
    scheduleMode: z.enum(["simple", "advanced"]).default("simple"),
    schedule_time: opt(z.string().refine(isValidHHMM, "Dạng HH:MM")),
    schedule_days: z.array(z.coerce.number().int().min(0).max(6)).default([]),
    cron_advanced: opt(z.string().max(100)),
  })
  .superRefine((d, ctx) => {
    const err = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (d.maxStake > d.dailyBudget) err("maxStake", "Không được lớn hơn ngân sách ngày");
    if (d.takeProfitType === "PERCENT" && d.takeProfitValue > 100) err("takeProfitValue", "Tối đa 100%");
    if (d.stopLossType === "PERCENT" && d.stopLossValue > 100) err("stopLossValue", "Tối đa 100%");
    if (d.stakeMode === "PERCENT_BALANCE" && !d.stake_percent) err("stake_percent", "Bắt buộc");
    if (["FIXED", "MARTINGALE", "ANTI_MARTINGALE"].includes(d.stakeMode) && !d.stake_base) err("stake_base", "Bắt buộc");
    if (d.stakeMode === "SEQUENCE" && !parseSequence(d.stake_sequence ?? "").length) err("stake_sequence", "Nhập dãy số, VD: 10000, 20000, 40000");
    if (d.directionMode === "PATTERN" && !parsePattern(d.dir_pattern ?? "").length) err("dir_pattern", "Nhập chuỗi, VD: UP, UP, DOWN");
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: d.timezone });
    } catch {
      err("timezone", "Múi giờ không hợp lệ");
    }
    if (d.enabled) {
      if (d.scheduleMode === "simple") {
        if (!d.schedule_time) err("schedule_time", "Chọn giờ chạy");
        if (!d.schedule_days.length) err("schedule_days", "Chọn ít nhất 1 ngày");
      } else {
        const e = d.cron_advanced ? validateCron(d.cron_advanced, d.timezone) : "Nhập biểu thức cron";
        if (e) err("cron_advanced", e);
      }
    }
  });

/** Biểu thức cron từ form (null nếu chưa đủ thông tin). */
export function cronFromForm(d: Pick<BotFormInput, "scheduleMode" | "schedule_time" | "schedule_days" | "cron_advanced">): string | null {
  try {
    if (d.scheduleMode === "advanced") return d.cron_advanced?.trim() || null;
    return d.schedule_time && d.schedule_days.length ? buildCron(d.schedule_time, d.schedule_days) : null;
  } catch {
    return null;
  }
}

export type BotFormInput = z.infer<typeof botFormSchema>;
export type BotFormState = { errors?: Record<string, string[] | undefined>; message?: string };

export function parseSequence(s: string): number[] {
  return s
    .split(/[,;\s]+/)
    .map((x) => Number(x.replace(/[._]/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, 50);
}

export function parsePattern(s: string): Dir[] {
  const map: Record<string, Dir> = { UP: "UP", U: "UP", T: "UP", "TĂNG": "UP", TANG: "UP", DOWN: "DOWN", D: "DOWN", G: "DOWN", "GIẢM": "DOWN", GIAM: "DOWN" };
  return s
    .split(/[,;\s]+/)
    .map((x) => map[x.trim().toUpperCase()])
    .filter(Boolean)
    .slice(0, 100);
}

/** Dữ liệu form → dữ liệu lưu DB (stakeConfig / directionConfig dạng JSON). */
export function toBotData(d: BotFormInput) {
  const stakeConfig: StakeConfig = { roundTo: d.stake_roundTo ?? 1000 };
  if (d.stake_base) stakeConfig.base = d.stake_base;
  if (d.stakeMode === "PERCENT_BALANCE") stakeConfig.percent = d.stake_percent;
  if (d.stakeMode === "MARTINGALE" || d.stakeMode === "ANTI_MARTINGALE") {
    stakeConfig.multiplier = d.stake_multiplier ?? 2;
    if (d.stake_maxSteps !== undefined) stakeConfig.maxSteps = d.stake_maxSteps;
  }
  if (d.stakeMode === "SEQUENCE") stakeConfig.sequence = parseSequence(d.stake_sequence ?? "");

  const directionConfig: DirectionConfig = { initial: d.dir_initial ?? "UP" };
  if (d.directionMode === "FIXED") directionConfig.fixed = d.dir_fixed ?? "UP";
  if (d.directionMode === "PATTERN") directionConfig.pattern = parsePattern(d.dir_pattern ?? "");
  if (d.directionMode === "RULE") {
    directionConfig.streak = d.dir_streak ?? 3;
    directionConfig.streakAction = d.dir_streakAction ?? "reverse";
  }
  if (d.directionMode === "AI") {
    directionConfig.ai = {
      model: d.ai_model ?? AI_MODELS[0].id,
      effort: d.ai_effort ?? "low",
      minConfidence: (d.ai_minConfidence ?? 60) / 100,
      history: d.ai_history ?? 20,
      extraPrompt: d.ai_extraPrompt?.trim() || undefined,
    };
  }

  return {
    name: d.name,
    accountId: d.accountId,
    flowId: d.flowId,
    dryRun: d.dryRun,
    dailyBudget: d.dailyBudget,
    maxStake: d.maxStake,
    stakeMode: d.stakeMode,
    stakeConfig,
    directionMode: d.directionMode,
    directionConfig,
    takeProfitType: d.takeProfitType,
    takeProfitValue: d.takeProfitValue,
    stopLossType: d.stopLossType,
    stopLossValue: d.stopLossValue,
    maxConsecutiveLoss: d.maxConsecutiveLoss,
    maxOrdersPerDay: d.maxOrdersPerDay,
    windowStart: d.windowStart ?? null,
    windowEnd: d.windowEnd ?? null,
    timezone: d.timezone,
    roundDelaySec: d.roundDelaySec,
    settleDelaySec: d.settleDelaySec,
    payoutPercent: d.payoutPercent,
    enabled: d.enabled,
    ...(cronFromForm(d) && { cron: cronFromForm(d)! }),
  };
}

/** Giá trị form (chuỗi) từ bản ghi DB — dùng cho trang sửa. */
export type BotFormValues = Record<string, string | boolean>;

export function botToFormValues(b: {
  name: string; accountId: string; flowId: string | null; dryRun: boolean; dailyBudget: unknown; maxStake: unknown;
  stakeMode: string; stakeConfig: unknown; directionMode: string; directionConfig: unknown;
  takeProfitType: string; takeProfitValue: unknown; stopLossType: string; stopLossValue: unknown;
  maxConsecutiveLoss: number; maxOrdersPerDay: number; windowStart: string | null; windowEnd: string | null; timezone: string;
  roundDelaySec: number; settleDelaySec: number; payoutPercent: unknown; enabled: boolean; cron: string;
}): BotFormValues {
  const simple = parseSimpleCron(b.cron);
  const s = (b.stakeConfig ?? {}) as StakeConfig;
  const dc = (b.directionConfig ?? {}) as DirectionConfig;
  const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  return {
    name: b.name, accountId: b.accountId, flowId: b.flowId ?? "", dryRun: b.dryRun,
    dailyBudget: str(b.dailyBudget), maxStake: str(b.maxStake), stakeMode: b.stakeMode,
    stake_base: str(s.base), stake_percent: str(s.percent), stake_multiplier: str(s.multiplier), stake_maxSteps: str(s.maxSteps),
    stake_sequence: (s.sequence ?? []).join(", "), stake_roundTo: str(s.roundTo ?? 1000),
    directionMode: b.directionMode, dir_fixed: dc.fixed ?? "UP", dir_initial: dc.initial ?? "UP",
    dir_pattern: (dc.pattern ?? []).join(", "), dir_streak: str(dc.streak ?? 3), dir_streakAction: dc.streakAction ?? "reverse",
    ai_model: dc.ai?.model ?? AI_MODELS[0].id, ai_effort: dc.ai?.effort ?? "low",
    ai_minConfidence: str(Math.round((dc.ai?.minConfidence ?? 0.6) * 100)), ai_history: str(dc.ai?.history ?? 20), ai_extraPrompt: dc.ai?.extraPrompt ?? "",
    takeProfitType: b.takeProfitType, takeProfitValue: str(b.takeProfitValue), stopLossType: b.stopLossType, stopLossValue: str(b.stopLossValue),
    maxConsecutiveLoss: str(b.maxConsecutiveLoss), maxOrdersPerDay: str(b.maxOrdersPerDay),
    windowStart: b.windowStart ?? "", windowEnd: b.windowEnd ?? "", timezone: b.timezone,
    roundDelaySec: str(b.roundDelaySec), settleDelaySec: str(b.settleDelaySec), payoutPercent: str(b.payoutPercent),
    enabled: b.enabled, scheduleMode: simple ? "simple" : "advanced",
    schedule_time: simple?.time ?? "09:00", schedule_days: (simple?.days ?? [1, 2, 3, 4, 5]).join(","), cron_advanced: b.cron,
  };
}

export const DEFAULT_BOT_VALUES: BotFormValues = {
  name: "", accountId: "", flowId: "", dryRun: true,
  dailyBudget: "500000", maxStake: "80000", stakeMode: "FIXED",
  stake_base: "10000", stake_percent: "1", stake_multiplier: "2", stake_maxSteps: "3", stake_sequence: "10000, 20000, 40000", stake_roundTo: "1000",
  directionMode: "FOLLOW_LAST", dir_fixed: "UP", dir_initial: "UP", dir_pattern: "UP, UP, DOWN", dir_streak: "3", dir_streakAction: "reverse",
  ai_model: AI_MODELS[0].id, ai_effort: "low", ai_minConfidence: "60", ai_history: "20", ai_extraPrompt: "",
  takeProfitType: "AMOUNT", takeProfitValue: "100000", stopLossType: "AMOUNT", stopLossValue: "200000",
  maxConsecutiveLoss: "5", maxOrdersPerDay: "50", windowStart: "", windowEnd: "", timezone: "Asia/Ho_Chi_Minh",
  roundDelaySec: "2", settleDelaySec: "0", payoutPercent: "95",
  enabled: false, scheduleMode: "simple", schedule_time: "09:00", schedule_days: "1,2,3,4,5", cron_advanced: "0 9 * * 1-5",
};
