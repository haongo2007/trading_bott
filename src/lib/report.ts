// Tính toán báo cáo (hàm thuần, dễ test).

export type RunRow = { date: string; botId: string; botName: string; pnl: number; orders: number; wins: number; losses: number };

export type DayPoint = { date: string; pnl: number; cumulative: number; orders: number; wins: number; losses: number };

/** Gộp các phiên theo ngày, điền đủ các ngày trống trong khoảng [from, to] để trục thời gian liên tục. */
export function dailySeries(rows: RunRow[], from: string, to: string): DayPoint[] {
  const byDay = new Map<string, Omit<DayPoint, "date" | "cumulative">>();
  for (const r of rows) {
    const d = byDay.get(r.date) ?? { pnl: 0, orders: 0, wins: 0, losses: 0 };
    d.pnl += r.pnl;
    d.orders += r.orders;
    d.wins += r.wins;
    d.losses += r.losses;
    byDay.set(r.date, d);
  }
  const out: DayPoint[] = [];
  let cumulative = 0;
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    const d = byDay.get(date) ?? { pnl: 0, orders: 0, wins: 0, losses: 0 };
    cumulative += d.pnl;
    out.push({ date, cumulative, ...d });
  }
  return out;
}

/** Mức sụt giảm lớn nhất của đường lãi tích luỹ (từ đỉnh xuống đáy), tính bằng tiền (≥ 0). */
export function maxDrawdown(cumulative: number[]): number {
  let peak = 0;
  let worst = 0;
  for (const v of cumulative) {
    peak = Math.max(peak, v);
    worst = Math.max(worst, peak - v);
  }
  return worst;
}

export function summarize(days: DayPoint[]) {
  const active = days.filter((d) => d.orders > 0);
  const wins = days.reduce((s, d) => s + d.wins, 0);
  const losses = days.reduce((s, d) => s + d.losses, 0);
  const best = active.reduce<DayPoint | null>((b, d) => (!b || d.pnl > b.pnl ? d : b), null);
  const worst = active.reduce<DayPoint | null>((b, d) => (!b || d.pnl < b.pnl ? d : b), null);
  return {
    total: days.at(-1)?.cumulative ?? 0,
    activeDays: active.length,
    profitDays: active.filter((d) => d.pnl > 0).length,
    lossDays: active.filter((d) => d.pnl < 0).length,
    orders: days.reduce((s, d) => s + d.orders, 0),
    winRate: wins + losses ? wins / (wins + losses) : null,
    maxDrawdown: maxDrawdown(days.map((d) => d.cumulative)),
    best,
    worst,
  };
}

export function byBot(rows: RunRow[]) {
  const map = new Map<string, { botId: string; botName: string; pnl: number; days: number; orders: number; wins: number; losses: number }>();
  for (const r of rows) {
    const b = map.get(r.botId) ?? { botId: r.botId, botName: r.botName, pnl: 0, days: 0, orders: 0, wins: 0, losses: 0 };
    b.pnl += r.pnl;
    b.days += 1;
    b.orders += r.orders;
    b.wins += r.wins;
    b.losses += r.losses;
    map.set(r.botId, b);
  }
  return [...map.values()].sort((a, b) => b.pnl - a.pnl);
}

/** Một ô CSV an toàn (kể cả chống CSV injection khi mở bằng Excel). */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
