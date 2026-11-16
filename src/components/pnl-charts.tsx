"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { DayPoint } from "@/lib/report";

// Màu: cặp phân kỳ xanh (lãi) ↔ đỏ (lỗ), đã kiểm bằng validator dataviz cho nền sáng & tối.
const COLORS = {
  light: { "--viz-pos": "#2a78d6", "--viz-neg": "#e34948" },
  dark: { "--viz-pos": "#3987e5", "--viz-neg": "#e66767" },
} as const;

const DARK_QUERY = "(prefers-color-scheme: dark)";
function useVizColors(): React.CSSProperties {
  const dark = useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(DARK_QUERY);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(DARK_QUERY).matches,
    () => false,
  );
  return (dark ? COLORS.dark : COLORS.light) as React.CSSProperties;
}

const H = 220;
const M = { top: 12, right: 12, bottom: 28, left: 64 };

const fmtShort = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1e9 ? `${+(a / 1e9).toFixed(1)}tỷ` : a >= 1e6 ? `${+(a / 1e6).toFixed(1)}tr` : a >= 1e3 ? `${+(a / 1e3).toFixed(1)}k` : `${Math.round(a)}`;
  return n < 0 ? `-${s}` : s;
};
const fmtFull = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n).toLocaleString("vi-VN")}`;
const fmtDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceDomain(values: number[]): [number, number, number[]] {
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step || step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v));
  return [min, max, ticks];
}

function Axes({ w, ticks, y, days, xAt }: { w: number; ticks: number[]; y: (v: number) => number; days: DayPoint[]; xAt: (i: number) => number }) {
  const every = Math.max(1, Math.ceil(days.length / Math.floor((w - M.left) / 56)));
  return (
    <g className="text-[11px]">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={M.left} x2={w - M.right} y1={y(t)} y2={y(t)} className={t === 0 ? "stroke-base-content/40" : "stroke-base-content/10"} />
          <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-base-content/60">
            {fmtShort(t)}
          </text>
        </g>
      ))}
      {days.map((d, i) =>
        i % every === 0 ? (
          <text key={d.date} x={xAt(i)} y={H - 8} textAnchor="middle" className="fill-base-content/60">
            {fmtDate(d.date)}
          </text>
        ) : null,
      )}
    </g>
  );
}

function Tooltip({ x, w, children }: { x: number; w: number; children: React.ReactNode }) {
  const left = Math.min(Math.max(x - 90, 0), w - 180);
  return (
    <div className="pointer-events-none absolute top-0 z-10 w-[180px] rounded-box border border-base-300 bg-base-100 p-2 text-xs shadow-lg" style={{ left }}>
      {children}
    </div>
  );
}

/** Lãi/lỗ theo ngày — cột lên (xanh, lãi) / xuống (đỏ, lỗ) từ mốc 0. */
export function DailyPnlChart({ days }: { days: DayPoint[] }) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const [min, max, ticks] = niceDomain(days.map((d) => d.pnl));
  const innerW = w - M.left - M.right;
  const band = innerW / Math.max(days.length, 1);
  const barW = Math.max(2, Math.min(28, band - 2)); // khe 2px giữa các cột
  const y = (v: number) => M.top + ((max - v) / (max - min)) * (H - M.top - M.bottom);
  const xAt = (i: number) => M.left + band * i + band / 2;
  const y0 = y(0);

  const barPath = (i: number, v: number) => {
    const x = xAt(i) - barW / 2;
    const yv = y(v);
    const h = Math.abs(yv - y0);
    if (h < 0.5) return "";
    const r = Math.min(4, barW / 2, h); // bo 4px ở đầu dữ liệu, gốc vuông trên mốc 0
    if (v > 0)
      return `M${x},${y0} V${yv + r} Q${x},${yv} ${x + r},${yv} H${x + barW - r} Q${x + barW},${yv} ${x + barW},${yv + r} V${y0} Z`;
    return `M${x},${y0} V${yv - r} Q${x},${yv} ${x + r},${yv} H${x + barW - r} Q${x + barW},${yv} ${x + barW},${yv - r} V${y0} Z`;
  };

  const d = hover !== null ? days[hover] : null;
  const colors = useVizColors();
  return (
    <div className="viz-root" style={colors}>
      <div className="mb-2 flex items-center gap-4 text-xs text-base-content/70">
        <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm" style={{ background: "var(--viz-pos)" }} /> Lãi</span>
        <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm" style={{ background: "var(--viz-neg)" }} /> Lỗ</span>
      </div>
      <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
        <svg width={w} height={H} role="img" aria-label="Biểu đồ lãi/lỗ theo ngày">
          <Axes w={w} ticks={ticks} y={y} days={days} xAt={xAt} />
          {days.map((p, i) => (
            <path key={p.date} d={barPath(i, p.pnl)} fill={p.pnl >= 0 ? "var(--viz-pos)" : "var(--viz-neg)"} opacity={hover === null || hover === i ? 1 : 0.45} />
          ))}
          {days.map((p, i) => (
            <rect key={`hit-${p.date}`} x={M.left + band * i} y={M.top} width={band} height={H - M.top - M.bottom} fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
        </svg>
        {d && (
          <Tooltip x={xAt(hover!)} w={w}>
            <div className="font-semibold">{fmtDate(d.date)}/{d.date.slice(0, 4)}</div>
            <div className="mt-1 flex justify-between"><span className="text-base-content/60">Lãi/lỗ</span><b>{fmtFull(d.pnl)}</b></div>
            <div className="flex justify-between"><span className="text-base-content/60">Lệnh</span><span>{d.orders} ({d.wins}T / {d.losses}B)</span></div>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

/** Lãi/lỗ tích luỹ — 1 đường, crosshair khi rê chuột. */
export function CumulativePnlChart({ days }: { days: DayPoint[] }) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const [min, max, ticks] = niceDomain(days.map((d) => d.cumulative));
  const innerW = w - M.left - M.right;
  const step = innerW / Math.max(days.length - 1, 1);
  const xAt = (i: number) => M.left + step * i;
  const y = (v: number) => M.top + ((max - v) / (max - min)) * (H - M.top - M.bottom);
  const line = days.map((p, i) => `${i ? "L" : "M"}${xAt(i)},${y(p.cumulative)}`).join(" ");
  const d = hover !== null ? days[hover] : null;
  const colors = useVizColors();

  return (
    <div className="viz-root" style={colors}>
      <div
        ref={ref}
        className="relative"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
          setHover(Math.min(days.length - 1, Math.max(0, Math.round((x - M.left) / step))));
        }}
      >
        <svg width={w} height={H} role="img" aria-label="Biểu đồ lãi/lỗ tích luỹ">
          <Axes w={w} ticks={ticks} y={y} days={days} xAt={xAt} />
          <path d={line} fill="none" stroke="var(--viz-pos)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {d && (
            <>
              <line x1={xAt(hover!)} x2={xAt(hover!)} y1={M.top} y2={H - M.bottom} className="stroke-base-content/30" strokeDasharray="3 3" />
              <circle cx={xAt(hover!)} cy={y(d.cumulative)} r={5} fill="var(--viz-pos)" className="stroke-base-100" strokeWidth={2} />
            </>
          )}
        </svg>
        {d && (
          <Tooltip x={xAt(hover!)} w={w}>
            <div className="font-semibold">{fmtDate(d.date)}/{d.date.slice(0, 4)}</div>
            <div className="mt-1 flex justify-between"><span className="text-base-content/60">Tích luỹ</span><b>{fmtFull(d.cumulative)}</b></div>
            <div className="flex justify-between"><span className="text-base-content/60">Trong ngày</span><span>{fmtFull(d.pnl)}</span></div>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
