import { CronExpressionParser } from "cron-parser";

// Lịch chạy bot: biểu thức cron 5 trường (phút giờ ngày tháng thứ), tính theo múi giờ của bot.

export const WEEKDAYS = [
  { value: 1, short: "T2" },
  { value: 2, short: "T3" },
  { value: 3, short: "T4" },
  { value: 4, short: "T5" },
  { value: 5, short: "T6" },
  { value: 6, short: "T7" },
  { value: 0, short: "CN" },
] as const;

/** Cửa sổ chạy bù: worker tắt đúng giờ lịch, bật lại trong khoảng này vẫn chạy. */
export const CATCHUP_MS = 30 * 60_000;

/** "09:30" + [1..5] → "30 9 * * 1,2,3,4,5" */
export function buildCron(time: string, days: number[]): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) throw new Error("Giờ chạy phải dạng HH:MM");
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error("Giờ chạy không hợp lệ");
  const uniq = [...new Set(days)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  if (!uniq.length) throw new Error("Chọn ít nhất 1 ngày trong tuần");
  return `${min} ${h} * * ${uniq.length === 7 ? "*" : uniq.join(",")}`;
}

/** Ngược lại với buildCron — null nếu là cron nâng cao không biểu diễn được bằng giờ + thứ. */
export function parseSimpleCron(expr: string): { time: string; days: number[] } | null {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|[0-6](?:,[0-6])*)$/.exec(expr.trim());
  if (!m) return null;
  const days = m[3] === "*" ? [0, 1, 2, 3, 4, 5, 6] : m[3].split(",").map(Number);
  return { time: `${m[2].padStart(2, "0")}:${m[1].padStart(2, "0")}`, days };
}

export function validateCron(expr: string, tz: string): string | null {
  if (expr.trim().split(/\s+/).length !== 5) return "Cron phải có đúng 5 trường: phút giờ ngày tháng thứ";
  try {
    CronExpressionParser.parse(expr, { tz, currentDate: new Date() }).next();
    return null;
  } catch (e) {
    return `Cron không hợp lệ: ${(e as Error).message}`;
  }
}

export function nextRuns(expr: string, tz: string, from = new Date(), count = 3): Date[] {
  try {
    const it = CronExpressionParser.parse(expr, { tz, currentDate: from });
    return Array.from({ length: count }, () => it.next().toDate());
  } catch {
    return [];
  }
}

/**
 * Thời điểm lịch cần chạy ngay bây giờ (hoặc null).
 * - Lấy mốc lịch gần nhất ≤ now.
 * - Bỏ qua nếu mốc đó đã được xử lý (≤ lastScheduledAt) hoặc đã quá cửa sổ chạy bù.
 */
export function dueRun(expr: string, tz: string, now: Date, lastScheduledAt: Date | null, catchupMs = CATCHUP_MS): Date | null {
  let prev: Date;
  try {
    prev = CronExpressionParser.parse(expr, { tz, currentDate: now }).prev().toDate();
  } catch {
    return null;
  }
  if (lastScheduledAt && prev.getTime() <= lastScheduledAt.getTime()) return null;
  if (now.getTime() - prev.getTime() > catchupMs) return null;
  return prev;
}

export function describeCron(expr: string): string {
  const simple = parseSimpleCron(expr);
  if (!simple) return `Cron: ${expr}`;
  const { time, days } = simple;
  if (days.length === 7) return `Hằng ngày lúc ${time}`;
  const weekdays = [1, 2, 3, 4, 5];
  if (days.length === 5 && weekdays.every((d) => days.includes(d))) return `T2–T6 lúc ${time}`;
  const names = WEEKDAYS.filter((w) => days.includes(w.value)).map((w) => w.short);
  return `${names.join(", ")} lúc ${time}`;
}
