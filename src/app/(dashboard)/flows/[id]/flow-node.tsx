"use client";

import { createContext, memo, useContext } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  ArrowUpDown, Camera, CircleDollarSign, CircleStop, Clock, Eye, GitBranch, Globe, Keyboard, MousePointerClick, Play, ScanText, ShieldAlert, TextCursorInput,
  type LucideIcon,
} from "lucide-react";
import { NODE_META, nodeTitle, summarizeNode, type FlowNodeData, type FlowNodeType, type RunLogStatus } from "@/lib/flow";

export type EditorNode = Node<FlowNodeData, FlowNodeType>;

export const NODE_ICONS: Record<FlowNodeType, LucideIcon> = {
  start: Play,
  goto: Globe,
  click: MousePointerClick,
  fill: TextCursorInput,
  press: Keyboard,
  waitFor: Eye,
  wait: Clock,
  readText: ScanText,
  order: CircleDollarSign,
  direction: ArrowUpDown,
  condition: GitBranch,
  screenshot: Camera,
  end: CircleStop,
};

// Tailwind cần tên class tĩnh
export const COLOR_CLASSES: Record<string, string> = {
  success: "bg-success/15 text-success",
  info: "bg-info/15 text-info",
  primary: "bg-primary/15 text-primary",
  warning: "bg-warning/15 text-warning",
  secondary: "bg-secondary/15 text-secondary",
  accent: "bg-accent/15 text-accent",
  neutral: "bg-base-300 text-base-content",
  error: "bg-error/15 text-error",
};

const STATUS_CLASSES: Record<RunLogStatus, string> = {
  running: "border-primary ring-4 ring-primary/40 animate-pulse",
  ok: "border-success ring-2 ring-success/30",
  skipped: "border-warning ring-2 ring-warning/40",
  error: "border-error ring-4 ring-error/40",
};

/** Trạng thái chạy của từng khối (không lưu vào graph). */
export const RunStatusContext = createContext<Record<string, RunLogStatus>>({});
/** Các khối đang có lỗi cấu hình. */
export const InvalidNodesContext = createContext<Set<string>>(new Set());

const handleCls = "!size-3 !border-2 !border-base-100 !bg-base-content/60";

function FlowNodeCardImpl({ id, type, data, selected }: NodeProps<EditorNode>) {
  const status = useContext(RunStatusContext)[id];
  const invalid = useContext(InvalidNodesContext).has(id);
  const meta = NODE_META[type];
  const Icon = NODE_ICONS[type];
  const summary = summarizeNode({ type, data });

  return (
    <div
      className={`w-64 rounded-box border-2 bg-base-100 shadow-sm transition ${
        status ? STATUS_CLASSES[status] : invalid ? "border-error/60 border-dashed" : selected ? "border-primary" : "border-base-300"
      }`}
    >
      {type !== "start" && <Handle type="target" position={Position.Top} className={handleCls} />}

      <div className="flex items-center gap-2 p-2.5">
        <div className={`grid size-8 shrink-0 place-items-center rounded-field ${COLOR_CLASSES[meta.color]}`}>
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span className="truncate text-sm font-semibold">{nodeTitle({ type, data })}</span>
            {(data.critical || type === "order") && (
              <span className="tooltip tooltip-top" data-tip="Thao tác đặt lệnh — bỏ qua khi chạy thử">
                <ShieldAlert className="size-3.5 text-warning" />
              </span>
            )}
            {data.optional && <span className="badge badge-ghost badge-xs">tuỳ chọn</span>}
          </div>
          {summary ? (
            <div className="truncate font-mono text-[11px] text-base-content/60">{summary}</div>
          ) : (
            <div className="text-[11px] text-base-content/40">{meta.desc}</div>
          )}
        </div>
      </div>

      {type === "condition" ? (
        <>
          <Handle id="true" type="source" position={Position.Bottom} style={{ left: "28%" }} className={`${handleCls} !bg-success`} />
          <Handle id="false" type="source" position={Position.Bottom} style={{ left: "72%" }} className={`${handleCls} !bg-error`} />
          <div className="flex justify-between px-8 pb-1 text-[10px] font-semibold">
            <span className="text-success">Đúng</span>
            <span className="text-error">Sai</span>
          </div>
        </>
      ) : type === "direction" ? (
        <>
          <Handle id="up" type="source" position={Position.Bottom} style={{ left: "28%" }} className={`${handleCls} !bg-success`} />
          <Handle id="down" type="source" position={Position.Bottom} style={{ left: "72%" }} className={`${handleCls} !bg-error`} />
          <div className="flex justify-between px-8 pb-1 text-[10px] font-semibold">
            <span className="text-success">▲ TĂNG</span>
            <span className="text-error">▼ GIẢM</span>
          </div>
        </>
      ) : (
        type !== "end" && <Handle id="next" type="source" position={Position.Bottom} className={handleCls} />
      )}
    </div>
  );
}

export const FlowNodeCard = memo(FlowNodeCardImpl);
