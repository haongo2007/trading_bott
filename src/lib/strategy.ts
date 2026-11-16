// Bộ máy chiến lược: hàm thuần (không I/O) để dễ test.
// Dùng chung cho worker (chạy bot) và dashboard (mô tả/preview).

export type Dir = "UP" | "DOWN";
export type OrderResultKind = "PENDING" | "WIN" | "LOSS" | "DRAW" | "UNKNOWN";
export type OrderOutcome = { direction: Dir; amount: number; result: OrderResultKind };

export type StakeMode = "FIXED" | "PERCENT_BALANCE" | "MARTINGALE" | "ANTI_MARTINGALE" | "SEQUENCE";
export type DirectionMode = "FIXED" | "FOLLOW_LAST" | "REVERSE_LAST" | "PATTERN" | "RANDOM" | "RULE" | "AI";

export type StakeConfig = {
  base?: number; // tiền gốc mỗi lệnh
  percent?: number; // % số dư (PERCENT_BALANCE)
  multiplier?: number; // hệ số nhân (MARTINGALE / ANTI_MARTINGALE)
  maxSteps?: number; // số lần nhân tối đa
  sequence?: number[]; // dãy tiền (SEQUENCE)
  roundTo?: number; // làm tròn tới bội số (mặc định 1000)
};

export type AiConfig = {
  model?: string;
  effort?: "low" | "medium" | "high";
  minConfidence?: number; // 0..1 — thấp hơn thì bỏ qua phiên
  history?: number; // số lệnh gần nhất gửi cho AI
  extraPrompt?: string;
};

export type DirectionConfig = {
  fixed?: Dir;
  initial?: Dir; // hướng cho lệnh đầu tiên khi chưa có lịch sử
  pattern?: Dir[];
  streak?: number; // RULE: N phiên cùng kết quả
  streakAction?: "reverse" | "follow";
  ai?: AiConfig;
};

export const STAKE_MODE_LABELS: Record<StakeMode, string> = {
  FIXED: "Cố định",
  PERCENT_BALANCE: "% số dư",
  MARTINGALE: "Martingale (thua thì nhân lên)",
  ANTI_MARTINGALE: "Anti-martingale (thắng thì nhân lên)",
  SEQUENCE: "Theo dãy số",
};

export const DIRECTION_MODE_LABELS: Record<DirectionMode, string> = {
  FIXED: "Luôn một hướng",
  FOLLOW_LAST: "Theo kết quả phiên trước",
  REVERSE_LAST: "Ngược kết quả phiên trước",
  PATTERN: "Theo chuỗi mẫu",
  RANDOM: "Ngẫu nhiên",
  RULE: "Quy tắc chuỗi (N phiên cùng màu)",
  AI: "AI dự đoán (Claude)",
};

export const opposite = (d: Dir): Dir => (d === "UP" ? "DOWN" : "UP");

/** Kết quả thị trường suy ra từ lệnh của mình: thắng → thị trường đi đúng hướng mình đặt. */
export function marketOutcome(o: OrderOutcome): Dir | null {
  if (o.result === "WIN") return o.direction;
  if (o.result === "LOSS") return opposite(o.direction);
  return null;
}

function trailing(history: OrderOutcome[], result: OrderResultKind) {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const r = history[i].result;
    if (r === "DRAW" || r === "UNKNOWN" || r === "PENDING") continue; // hoà/không rõ không phá chuỗi
    if (r !== result) break;
    n++;
  }
  return n;
}

export const lossStreak = (h: OrderOutcome[]) => trailing(h, "LOSS");
export const winStreak = (h: OrderOutcome[]) => trailing(h, "WIN");

function roundStake(x: number, roundTo: number) {
  const step = roundTo > 0 ? roundTo : 1;
  return Math.max(step, Math.round(x / step) * step);
}

/** Tiền cho lệnh tiếp theo (chưa áp trần maxStake — caller tự áp). */
export function nextStake(mode: StakeMode, cfg: StakeConfig, history: OrderOutcome[], balance: number): number {
  const base = cfg.base ?? 10_000;
  const roundTo = cfg.roundTo ?? 1000;
  const mult = cfg.multiplier ?? 2;
  switch (mode) {
    case "FIXED":
      return roundStake(base, roundTo);
    case "PERCENT_BALANCE":
      return roundStake((balance * (cfg.percent ?? 1)) / 100, roundTo);
    case "MARTINGALE":
      return roundStake(base * mult ** Math.min(lossStreak(history), cfg.maxSteps ?? 6), roundTo);
    case "ANTI_MARTINGALE":
      return roundStake(base * mult ** Math.min(winStreak(history), cfg.maxSteps ?? 3), roundTo);
    case "SEQUENCE": {
      const seq = cfg.sequence?.length ? cfg.sequence : [base];
      // thua → bước tiếp theo trong dãy; thắng → về đầu dãy; hết dãy → quay lại đầu
      return roundStake(seq[lossStreak(history) % seq.length], roundTo);
    }
  }
}

/** Hướng cho lệnh tiếp theo. Trả về "AI" khi cần gọi AI (bất đồng bộ, worker xử lý). */
export function nextDirection(
  mode: DirectionMode,
  cfg: DirectionConfig,
  history: OrderOutcome[],
  rand: () => number = Math.random,
): Dir | "AI" {
  const initial = cfg.initial ?? "UP";
  const markets = history.map(marketOutcome).filter((d): d is Dir => d !== null);
  const last = markets.at(-1);
  switch (mode) {
    case "FIXED":
      return cfg.fixed ?? "UP";
    case "FOLLOW_LAST":
      return last ?? initial;
    case "REVERSE_LAST":
      return last ? opposite(last) : initial;
    case "PATTERN": {
      const p = cfg.pattern?.length ? cfg.pattern : [initial];
      return p[history.length % p.length];
    }
    case "RANDOM":
      return rand() < 0.5 ? "UP" : "DOWN";
    case "RULE": {
      const n = Math.max(2, cfg.streak ?? 3);
      const tail = markets.slice(-n);
      if (tail.length === n && tail.every((d) => d === tail[0])) {
        return cfg.streakAction === "follow" ? tail[0] : opposite(tail[0]);
      }
      return last ?? initial;
    }
    case "AI":
      return "AI";
  }
}

// ───────────── Rủi ro ─────────────

export type ValueType = "AMOUNT" | "PERCENT";

export function computeLimits(
  b: { takeProfitType: ValueType; takeProfitValue: number; stopLossType: ValueType; stopLossValue: number },
  startBalance: number,
) {
  const conv = (t: ValueType, v: number) => (t === "PERCENT" ? Math.round((startBalance * v) / 100) : v);
  return { target: conv(b.takeProfitType, b.takeProfitValue), lossLimit: conv(b.stopLossType, b.stopLossValue) };
}

export type StopReasonKind =
  | "TAKE_PROFIT" | "STOP_LOSS" | "MAX_CONSECUTIVE_LOSS" | "MAX_ORDERS" | "BUDGET_EXHAUSTED"
  | "WINDOW_ENDED" | "MANUAL" | "KILL_SWITCH" | "ERROR";

export const STOP_REASON_LABELS: Record<StopReasonKind, string> = {
  TAKE_PROFIT: "Đạt mục tiêu lãi ngày",
  STOP_LOSS: "Chạm cắt lỗ ngày",
  MAX_CONSECUTIVE_LOSS: "Thua liên tiếp quá giới hạn",
  MAX_ORDERS: "Đủ số lệnh tối đa trong ngày",
  BUDGET_EXHAUSTED: "Hết ngân sách ngày",
  WINDOW_ENDED: "Hết khung giờ chạy",
  MANUAL: "Dừng thủ công",
  KILL_SWITCH: "Dừng khẩn cấp",
  ERROR: "Lỗi",
};

export type RiskState = { pnl: number; consecutiveLosses: number; orderCount: number };
export type RiskLimits = { target: number; lossLimit: number; maxConsecutiveLoss: number; maxOrdersPerDay: number };

/** Kiểm tra TRƯỚC mỗi lệnh. Trả về lý do dừng hoặc null nếu được đặt tiếp. */
export function checkStop(s: RiskState, l: RiskLimits): StopReasonKind | null {
  if (l.target > 0 && s.pnl >= l.target) return "TAKE_PROFIT";
  if (l.lossLimit > 0 && -s.pnl >= l.lossLimit) return "STOP_LOSS";
  if (l.maxConsecutiveLoss > 0 && s.consecutiveLosses >= l.maxConsecutiveLoss) return "MAX_CONSECUTIVE_LOSS";
  if (l.maxOrdersPerDay > 0 && s.orderCount >= l.maxOrdersPerDay) return "MAX_ORDERS";
  return null;
}

/**
 * Số tiền thực sự được đặt: áp trần maxStake, không vượt số dư, không vượt ngân sách còn lại,
 * và không để 1 lệnh thua làm vượt mức cắt lỗ. null = không đủ điều kiện đặt.
 */
export function clampStake(
  amount: number,
  opts: { maxStake: number; balance: number; budgetLeft: number; lossRoom: number | null; minStake: number },
): number | null {
  let a = Math.min(amount, opts.maxStake, opts.balance, opts.budgetLeft);
  if (opts.lossRoom !== null) a = Math.min(a, opts.lossRoom);
  return a >= opts.minStake ? a : null;
}

/** Lãi/lỗ của 1 lệnh. Thắng nhận amount × payout%, thua mất amount. */
export function settlePnl(amount: number, result: OrderResultKind, payoutPercent: number): number {
  if (result === "WIN") return Math.round((amount * payoutPercent) / 100);
  if (result === "LOSS") return -amount;
  return 0;
}

export function resultFromPnl(pnl: number): OrderResultKind {
  return pnl > 0 ? "WIN" : pnl < 0 ? "LOSS" : "DRAW";
}

// ───────────── Thời gian theo múi giờ ─────────────

function parts(now: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** "YYYY-MM-DD" theo múi giờ của bot — mỗi ngày giao dịch 1 phiên. */
export function tradingDate(now: Date, tz: string): string {
  return parts(now, tz).date;
}

const hhmm = (s: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Có đang trong khung giờ được phép chạy? Hỗ trợ khung qua đêm (VD 22:00 → 02:00). */
export function inWindow(now: Date, tz: string, start?: string | null, end?: string | null): boolean {
  const s = start ? hhmm(start) : null;
  const e = end ? hhmm(end) : null;
  if (s === null && e === null) return true;
  const m = parts(now, tz).minutes;
  if (s !== null && e !== null) return s <= e ? m >= s && m < e : m >= s || m < e;
  if (s !== null) return m >= s;
  return m < e!;
}

export function isValidHHMM(s: string) {
  const v = hhmm(s);
  return v !== null && v < 24 * 60;
}
