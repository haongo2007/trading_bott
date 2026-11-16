"use client";

import { Copy, Crosshair, Trash2 } from "lucide-react";
import { COND_OPS, NODE_META, PRESS_KEYS, type FlowNodeData } from "@/lib/flow";
import { COLOR_CLASSES, NODE_ICONS, type EditorNode } from "./flow-node";

const OP_LABELS: Record<string, string> = {
  "==": "bằng", "!=": "khác", ">": "lớn hơn", ">=": "lớn hơn hoặc bằng", "<": "nhỏ hơn", "<=": "nhỏ hơn hoặc bằng",
  contains: "có chứa", exists: "có giá trị",
};

type Props = {
  node: EditorNode;
  varNames: string[];
  readOnly?: boolean;
  onChange: (patch: Partial<FlowNodeData>) => void;
  onDelete: () => void;
  onDuplicate?: () => void;
  /** Mở trình duyệt để chọn phần tử cho một ô selector của khối. */
  onPick?: (field: SelectorField, label: string) => void;
  /** Ô selector đang chờ chọn trên trình duyệt (để tô sáng nút). */
  pickingField?: SelectorField | null;
};

export const SELECTOR_FIELDS = ["selector", "amountSelector", "upSelector", "downSelector", "confirmSelector"] as const;
export type SelectorField = (typeof SELECTOR_FIELDS)[number];

export function NodeInspector({ node, varNames, readOnly, onChange, onDelete, onDuplicate, onPick, pickingField }: Props) {
  const { type, data: d } = node;
  const meta = NODE_META[type];
  const Icon = NODE_ICONS[type];
  const str = (k: keyof FlowNodeData) => (d[k] as string | undefined) ?? "";
  const set = (k: keyof FlowNodeData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    onChange({ [k]: e.target.value || undefined });
  const seconds = (ms: number | undefined, fallback: number) => ((ms ?? fallback) / 1000).toString();
  const setSeconds = (k: "ms" | "timeoutMs") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    onChange({ [k]: Number.isFinite(v) && e.target.value !== "" ? Math.round(v * 1000) : undefined });
  };

  const hasSelector = ["click", "fill", "waitFor", "readText"].includes(type);

  /** Ô nhập selector + nút 🎯 chọn trên trình duyệt. */
  const selectorInput = (k: SelectorField, label: string, placeholder?: string) => {
    const picking = pickingField === k;
    return (
      <div className="join w-full">
        <input
          className="input input-sm join-item w-full font-mono text-xs"
          value={str(k)}
          onChange={set(k)}
          placeholder={placeholder}
        />
        {onPick && !readOnly && (
          <button
            type="button"
            className={`btn btn-sm join-item ${picking ? "btn-primary" : ""}`}
            onClick={() => onPick(k, label)}
            title="Chọn phần tử trên trình duyệt"
            aria-label={`Chọn phần tử cho ${label}`}
          >
            <Crosshair className={`size-4 ${picking ? "animate-pulse" : ""}`} />
          </button>
        )}
      </div>
    );
  };
  const hasTimeout = ["click", "fill", "waitFor", "readText", "goto", "order"].includes(type);

  return (
    <fieldset disabled={readOnly} className="space-y-3">
      <div className="flex items-center gap-2">
        <div className={`grid size-9 place-items-center rounded-field ${COLOR_CLASSES[meta.color]}`}>
          <Icon className="size-4" />
        </div>
        <div className="flex-1">
          <div className="font-semibold">{meta.label}</div>
          <div className="text-xs text-base-content/60">{meta.desc}</div>
        </div>
        {type !== "start" && !readOnly && onDuplicate && (
          <button className="btn btn-ghost btn-sm btn-square" onClick={onDuplicate} aria-label="Nhân bản khối" title="Nhân bản (Ctrl/⌘ + D)">
            <Copy className="size-4" />
          </button>
        )}
        {type !== "start" && !readOnly && (
          <button className="btn btn-ghost btn-sm btn-square text-error" onClick={onDelete} aria-label="Xoá khối">
            <Trash2 className="size-4" />
          </button>
        )}
      </div>

      <Field label="Tên hiển thị (tuỳ chọn)">
        <input className="input input-sm w-full" value={str("label")} onChange={set("label")} placeholder={meta.label} />
      </Field>

      {type === "goto" && (
        <Field label="URL" hint="Có thể dùng {{tradeUrl}}, {{loginUrl}}">
          <input className="input input-sm w-full font-mono text-xs" value={str("url")} onChange={set("url")} placeholder="https://… hoặc {{tradeUrl}}" />
        </Field>
      )}

      {hasSelector && (
        <Field label="Selector" hint="Bấm 🎯 để chọn phần tử trực tiếp trên trang">
          {selectorInput("selector", "Selector", "#btn-up")}
        </Field>
      )}

      {type === "fill" && (
        <Field label="Giá trị nhập" hint="Biến: {{username}}, {{password}}, hoặc biến do khối “Đọc giá trị” tạo">
          <input className="input input-sm w-full font-mono text-xs" value={str("value")} onChange={(e) => onChange({ value: e.target.value })} />
        </Field>
      )}

      {type === "press" && (
        <Field label="Phím">
          <select className="select select-sm w-full" value={str("key")} onChange={set("key")}>
            <option value="">— Chọn phím —</option>
            {PRESS_KEYS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Field>
      )}

      {type === "waitFor" && (
        <Field label="Chờ đến khi phần tử">
          <select className="select select-sm w-full" value={d.state ?? "visible"} onChange={set("state")}>
            <option value="visible">Hiện ra</option>
            <option value="hidden">Biến mất</option>
          </select>
        </Field>
      )}

      {type === "wait" && (
        <Field label="Thời gian chờ (giây)">
          <input type="number" min={0} step={0.5} className="input input-sm w-full" value={seconds(d.ms, 1000)} onChange={setSeconds("ms")} />
        </Field>
      )}

      {type === "readText" && (
        <>
          <Field label="Lưu vào biến" hint="Dùng lại bằng {{tên_biến}} hoặc trong khối Điều kiện">
            <input className="input input-sm w-full font-mono text-xs" value={str("saveAs")} onChange={set("saveAs")} placeholder="balance" />
          </Field>
          <Field label="Kiểu dữ liệu">
            <select className="select select-sm w-full" value={d.parse ?? "text"} onChange={set("parse")}>
              <option value="text">Chữ</option>
              <option value="number">Số (tự bỏ dấu phân cách, ₫, VND…)</option>
            </select>
          </Field>
        </>
      )}

      {type === "order" && (
        <>
          <div className="alert alert-info alert-soft py-2 text-xs">
            Bot truyền vào <code>{"{{amount}}"}</code> (số tiền) và <code>{"{{direction}}"}</code> (UP/DOWN). Khi chạy thử flow:
            amount = 10000, direction = UP. Khối này luôn được coi là thao tác đặt lệnh.
          </div>
          <Field label="Ô nhập số tiền (tuỳ chọn)">
            {selectorInput("amountSelector", "Ô nhập số tiền", "#amount")}
          </Field>
          <Field label="Nút TĂNG (UP)">
            {selectorInput("upSelector", "Nút TĂNG", "#btn-up")}
          </Field>
          <Field label="Nút GIẢM (DOWN)">
            {selectorInput("downSelector", "Nút GIẢM", "#btn-down")}
          </Field>
          <Field label="Nút xác nhận (tuỳ chọn)" hint="Nếu sàn hiện hộp thoại xác nhận sau khi bấm">
            {selectorInput("confirmSelector", "Nút xác nhận")}
          </Field>
        </>
      )}

      {type === "loopStart" && (
        <div className="alert alert-success alert-soft py-2 text-xs">
          <span>
            Khi bot chạy: các khối <b>phía trên</b> (đóng popup, chọn sản phẩm…) chạy <b>1 lần</b> đầu phiên; các khối <b>phía dưới</b>{" "}
            (rẽ hướng, nhập <code>{"{{amount}}"}</code>, bấm TĂNG/GIẢM) <b>lặp lại mỗi lệnh</b> trên cùng trình duyệt cho tới khi bot dừng
            (hết ngân sách, chạm chốt lời/cắt lỗ, hết khung giờ…). Không cần đưa bước đăng nhập vào flow — bot tự đăng nhập 1 lần bằng cấu
            hình tài khoản. Khi chạy thử flow, cả hai phần chạy một lượt.
          </span>
        </div>
      )}

      {type === "direction" && (
        <div className="alert alert-info alert-soft py-2 text-xs">
          <span>
            Rẽ nhánh theo hướng bot chọn (chiến lược hoặc AI): <b>▲ TĂNG</b> khi <code>{"{{direction}}"}</code> = UP, <b>▼ GIẢM</b> khi = DOWN.
            Mỗi nhánh nối tới tổ hợp thao tác riêng (Click, Nhập <code>{"{{amount}}"}</code>…). Đánh dấu nút bấm cuối cùng của mỗi nhánh là
            “Thao tác đặt lệnh” để bot biết lệnh đã được đặt.
          </span>
        </div>
      )}

      {type === "condition" && (
        <>
          <Field label="Biến (vế trái)">
            <input className="input input-sm w-full font-mono text-xs" list="flow-vars" value={str("left")} onChange={set("left")} placeholder="balance" />
            <datalist id="flow-vars">
              {varNames.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </Field>
          <Field label="Phép so sánh">
            <select className="select select-sm w-full" value={str("op")} onChange={set("op")}>
              <option value="">— Chọn —</option>
              {COND_OPS.map((o) => (
                <option key={o} value={o}>
                  {o} ({OP_LABELS[o]})
                </option>
              ))}
            </select>
          </Field>
          {d.op !== "exists" && (
            <Field label="Giá trị (vế phải)" hint="Số, chữ hoặc {{biến}}">
              <input className="input input-sm w-full font-mono text-xs" value={str("right")} onChange={set("right")} />
            </Field>
          )}
        </>
      )}

      {hasTimeout && (
        <Field label="Timeout (giây)">
          <input type="number" min={0.1} step={1} className="input input-sm w-full" value={seconds(d.timeoutMs, 10_000)} onChange={setSeconds("timeoutMs")} />
        </Field>
      )}

      {(type === "click" || type === "press") && (
        <Toggle
          checked={!!d.critical}
          onChange={(v) => onChange({ critical: v || undefined })}
          title="Thao tác đặt lệnh"
          desc="Khi chạy thử: chỉ tô sáng, KHÔNG bấm. Khi chạy thật: bấm xong coi như đã đặt lệnh. VD: nút TĂNG/GIẢM, xác nhận lệnh."
          cls="toggle-warning"
        />
      )}
      {!["start", "end", "condition", "direction", "loopStart"].includes(type) && (
        <Toggle
          checked={!!d.optional}
          onChange={(v) => onChange({ optional: v || undefined })}
          title="Không bắt buộc"
          desc="Nếu khối này lỗi, flow vẫn chạy tiếp (VD: đóng popup quảng cáo)."
        />
      )}
    </fieldset>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="fieldset py-0">
      <legend className="fieldset-legend pb-1 text-xs">{label}</legend>
      {children}
      {hint && <p className="label text-[11px] whitespace-normal">{hint}</p>}
    </fieldset>
  );
}

function Toggle({
  checked, onChange, title, desc, cls = "toggle-primary",
}: { checked: boolean; onChange: (v: boolean) => void; title: string; desc: string; cls?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-box border border-base-300 p-3">
      <input type="checkbox" className={`toggle toggle-sm ${cls} mt-0.5`} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="text-xs text-base-content/60">{desc}</span>
      </span>
    </label>
  );
}
