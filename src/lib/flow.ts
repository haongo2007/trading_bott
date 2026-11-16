import { z } from "zod";
import type { RecordedStep } from "@/lib/live-protocol";

// ───────────── Kiểu khối (node) của Flow ─────────────

export const NODE_TYPES = [
  "start", "goto", "click", "fill", "press", "waitFor", "wait", "readText", "order", "direction", "condition", "screenshot", "end",
] as const;
export type FlowNodeType = (typeof NODE_TYPES)[number];

export const COND_OPS = ["==", "!=", ">", ">=", "<", "<=", "contains", "exists"] as const;
export type CondOp = (typeof COND_OPS)[number];

export type FlowNodeData = {
  label?: string;
  url?: string; // goto
  selector?: string; // click, fill, waitFor, readText
  value?: string; // fill — hỗ trợ {{biến}}
  key?: string; // press
  state?: "visible" | "hidden"; // waitFor
  timeoutMs?: number;
  ms?: number; // wait
  saveAs?: string; // readText → tên biến
  parse?: "text" | "number"; // readText
  left?: string; // condition
  op?: CondOp;
  right?: string;
  amountSelector?: string; // order: ô nhập số tiền ({{amount}})
  upSelector?: string; // order: nút TĂNG
  downSelector?: string; // order: nút GIẢM
  confirmSelector?: string; // order: nút xác nhận (nếu sàn có)
  critical?: boolean; // thao tác đặt lệnh → bỏ qua khi chạy thử
  optional?: boolean; // lỗi thì vẫn chạy tiếp
};

export type FlowNode = { id: string; type: FlowNodeType; position: { x: number; y: number }; data: FlowNodeData };
export type FlowEdge = { id: string; source: string; target: string; sourceHandle?: string | null };
export type FlowGraph = { nodes: FlowNode[]; edges: FlowEdge[] };

export const NODE_META: Record<FlowNodeType, { label: string; desc: string; color: string }> = {
  start: { label: "Bắt đầu", desc: "Điểm bắt đầu của flow", color: "success" },
  goto: { label: "Mở trang", desc: "Điều hướng tới URL", color: "info" },
  click: { label: "Click", desc: "Click vào phần tử", color: "primary" },
  fill: { label: "Nhập", desc: "Nhập giá trị vào ô", color: "primary" },
  press: { label: "Nhấn phím", desc: "Enter, Tab, Escape…", color: "primary" },
  waitFor: { label: "Chờ phần tử", desc: "Chờ phần tử hiện/ẩn", color: "warning" },
  wait: { label: "Chờ", desc: "Dừng một khoảng thời gian", color: "warning" },
  readText: { label: "Đọc giá trị", desc: "Đọc chữ/số vào biến", color: "secondary" },
  order: { label: "Đặt lệnh", desc: "Nhập {{amount}}, bấm TĂNG/GIẢM theo bot", color: "error" },
  direction: { label: "Rẽ theo hướng", desc: "Nhánh TĂNG / GIẢM theo {{direction}} của bot", color: "accent" },
  condition: { label: "Điều kiện", desc: "Rẽ nhánh Đúng / Sai", color: "accent" },
  screenshot: { label: "Chụp màn hình", desc: "Lưu ảnh trang hiện tại", color: "neutral" },
  end: { label: "Kết thúc", desc: "Dừng flow", color: "error" },
};

export const PRESS_KEYS = ["Enter", "Tab", "Escape", "Backspace", "ArrowUp", "ArrowDown", "PageDown", "PageUp"] as const;

export const MAX_FLOW_STEPS = 300;

// ───────────── Schema (validate khi lưu) ─────────────

const varName = /^[a-zA-Z_][a-zA-Z0-9_]{0,40}$/;

const nodeDataSchema = z.object({
  label: z.string().max(100).optional(),
  url: z.string().max(2048).optional(),
  selector: z.string().max(1024).optional(),
  value: z.string().max(2000).optional(),
  key: z.enum(PRESS_KEYS).optional(),
  state: z.enum(["visible", "hidden"]).optional(),
  timeoutMs: z.number().int().min(100).max(120_000).optional(),
  ms: z.number().int().min(0).max(600_000).optional(),
  saveAs: z.string().regex(varName, "Tên biến chỉ gồm chữ, số, _ (không bắt đầu bằng số)").optional(),
  parse: z.enum(["text", "number"]).optional(),
  left: z.string().max(200).optional(),
  op: z.enum(COND_OPS).optional(),
  right: z.string().max(200).optional(),
  amountSelector: z.string().max(1024).optional(),
  upSelector: z.string().max(1024).optional(),
  downSelector: z.string().max(1024).optional(),
  confirmSelector: z.string().max(1024).optional(),
  critical: z.boolean().optional(),
  optional: z.boolean().optional(),
});

export const flowGraphSchema = z.object({
  nodes: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        type: z.enum(NODE_TYPES),
        position: z.object({ x: z.number(), y: z.number() }),
        data: nodeDataSchema,
      }),
    )
    .max(200),
  edges: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        source: z.string(),
        target: z.string(),
        sourceHandle: z.string().nullish(),
      }),
    )
    .max(400),
});

/** Kiểm tra cấu trúc & tham số từng khối. Trả về danh sách lỗi (rỗng = hợp lệ). */
export function validateFlow(graph: FlowGraph): { nodeId?: string; message: string }[] {
  const errors: { nodeId?: string; message: string }[] = [];
  const ids = new Set(graph.nodes.map((n) => n.id));
  const starts = graph.nodes.filter((n) => n.type === "start");
  if (starts.length !== 1) errors.push({ message: "Flow phải có đúng 1 khối Bắt đầu" });

  for (const e of graph.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) errors.push({ message: `Đường nối ${e.id} trỏ tới khối không tồn tại` });
  }

  for (const n of graph.nodes) {
    const d = n.data;
    const need = (cond: unknown, message: string) => !cond && errors.push({ nodeId: n.id, message: `${nodeTitle(n)}: ${message}` });
    switch (n.type) {
      case "goto":
        need(d.url?.trim(), "thiếu URL");
        break;
      case "click":
      case "waitFor":
        need(d.selector?.trim(), "thiếu selector");
        break;
      case "fill":
        need(d.selector?.trim(), "thiếu selector");
        need(d.value !== undefined, "thiếu giá trị nhập");
        break;
      case "readText":
        need(d.selector?.trim(), "thiếu selector");
        need(d.saveAs?.trim(), "thiếu tên biến lưu kết quả");
        break;
      case "press":
        need(d.key, "chưa chọn phím");
        break;
      case "order":
        need(d.upSelector?.trim(), "thiếu selector nút TĂNG");
        need(d.downSelector?.trim(), "thiếu selector nút GIẢM");
        break;
      case "condition":
        need(d.left?.trim(), "thiếu vế trái");
        need(d.op, "thiếu phép so sánh");
        break;
    }
    if (n.type !== "end") {
      for (const h of nodeHandles(n.type)) {
        if (!graph.edges.some((e) => e.source === n.id && (e.sourceHandle ?? "next") === h)) {
          if (n.type === "direction") errors.push({ nodeId: n.id, message: `${nodeTitle(n)}: chưa nối nhánh “${h === "up" ? "TĂNG" : "GIẢM"}”` });
          else if (n.type === "condition") errors.push({ nodeId: n.id, message: `${nodeTitle(n)}: chưa nối nhánh “${h === "true" ? "Đúng" : "Sai"}”` });
          else if (n.type === "start") errors.push({ nodeId: n.id, message: "Khối Bắt đầu chưa nối tới khối nào" });
        }
      }
    }
  }
  return errors;
}

/** Các cổng ra của một khối. */
export function nodeHandles(type: FlowNodeType): string[] {
  if (type === "end") return [];
  if (type === "condition") return ["true", "false"];
  if (type === "direction") return ["up", "down"];
  return ["next"];
}

export function nodeTitle(n: Pick<FlowNode, "type" | "data">) {
  return n.data.label?.trim() || NODE_META[n.type].label;
}

export function summarizeNode(n: Pick<FlowNode, "type" | "data">): string {
  const d = n.data;
  switch (n.type) {
    case "goto":
      return d.url ?? "";
    case "click":
    case "waitFor":
      return d.selector ?? "";
    case "fill":
      return `${d.selector ?? "?"} = ${d.value ?? ""}`;
    case "press":
      return d.key ?? "";
    case "wait":
      return `${((d.ms ?? 1000) / 1000).toLocaleString("vi-VN")} giây`;
    case "readText":
      return `${d.selector ?? "?"} → {{${d.saveAs ?? "?"}}}`;
    case "order":
      return `{{amount}} → ▲ ${d.upSelector ?? "?"} / ▼ ${d.downSelector ?? "?"}`;
    case "direction":
      return "{{direction}} → ▲ UP / ▼ DOWN";
    case "condition":
      return `${d.left ?? "?"} ${d.op ?? "?"} ${d.op === "exists" ? "" : (d.right ?? "")}`;
    default:
      return "";
  }
}

// ───────────── Hàm thuần dùng khi chạy flow ─────────────

/** Thay {{tên}} bằng giá trị biến. Biến không tồn tại được giữ nguyên để dễ phát hiện lỗi. */
export function renderTemplate(input: string, vars: Record<string, unknown>): string {
  return input.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (m, name: string) =>
    vars[name] === undefined || vars[name] === null ? m : String(vars[name]),
  );
}

/** Vế trái: tên biến (balance) hoặc template ({{balance}}). Vế phải: hằng số hoặc template. */
export function evalCondition(left: string, op: CondOp, right: string | undefined, vars: Record<string, unknown>): boolean {
  const l = left.includes("{{") ? renderTemplate(left, vars) : vars[left.trim()];
  if (op === "exists") return l !== undefined && l !== null && String(l) !== "" && !String(l).includes("{{");
  const r = renderTemplate(right ?? "", vars);
  const ln = Number(l);
  const rn = Number(r);
  const numeric = l !== undefined && l !== "" && r !== "" && Number.isFinite(ln) && Number.isFinite(rn);
  switch (op) {
    case "==":
      return numeric ? ln === rn : String(l ?? "") === r;
    case "!=":
      return numeric ? ln !== rn : String(l ?? "") !== r;
    case ">":
      return numeric && ln > rn;
    case ">=":
      return numeric && ln >= rn;
    case "<":
      return numeric && ln < rn;
    case "<=":
      return numeric && ln <= rn;
    case "contains":
      return String(l ?? "").toLowerCase().includes(r.toLowerCase());
  }
}

export function nextNodeId(graph: FlowGraph, nodeId: string, handle = "next"): string | null {
  return graph.edges.find((e) => e.source === nodeId && (e.sourceHandle ?? "next") === handle)?.target ?? null;
}

// ───────────── Tạo flow ─────────────

let seq = 0;
export function newNodeId(type: FlowNodeType) {
  seq = (seq + 1) % 1000;
  return `${type}_${Date.now().toString(36)}${seq.toString(36)}`;
}

export function defaultGraph(): FlowGraph {
  return {
    nodes: [
      { id: "start", type: "start", position: { x: 0, y: 0 }, data: {} },
      { id: "end", type: "end", position: { x: 0, y: 200 }, data: {} },
    ],
    edges: [{ id: "e_start_end", source: "start", target: "end", sourceHandle: "next" }],
  };
}

/**
 * Nhân bản các khối đã chọn cùng các đường nối NỘI BỘ giữa chúng (không lấy đường nối ra ngoài).
 * Khối Bắt đầu không được nhân bản. Bản sao đặt bên phải nhóm gốc, cách `gapX`.
 */
export function cloneSubgraph(
  nodes: FlowNode[],
  edges: FlowEdge[],
  opts: { times?: number; gapX?: number } = {},
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const src = nodes.filter((n) => n.type !== "start");
  if (!src.length) return { nodes: [], edges: [] };
  const minX = Math.min(...src.map((n) => n.position.x));
  const maxX = Math.max(...src.map((n) => n.position.x));
  const dx = (maxX - minX + 256 + (opts.gapX ?? 64)) * (opts.times ?? 1);

  const idMap = new Map<string, string>();
  const outNodes = src.map((n) => {
    const id = newNodeId(n.type);
    idMap.set(n.id, id);
    return { id, type: n.type, position: { x: n.position.x + dx, y: n.position.y }, data: structuredClone(n.data) };
  });
  const outEdges = edges
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((e) => {
      const source = idMap.get(e.source)!;
      const target = idMap.get(e.target)!;
      const handle = e.sourceHandle ?? "next";
      return { id: `e_${source}_${handle}_${target}`, source, target, sourceHandle: handle };
    });
  return { nodes: outNodes, edges: outEdges };
}

const STEP_GAP = 130;

/** Chuyển các bước ghi từ "Trình duyệt trực tiếp" thành một chuỗi khối thẳng hàng. */
export function stepsToGraph(steps: Pick<RecordedStep, "action" | "selector" | "value" | "url" | "key">[], startUrl?: string): FlowGraph {
  const nodes: FlowNode[] = [{ id: "start", type: "start", position: { x: 0, y: 0 }, data: {} }];
  const push = (type: FlowNodeType, data: FlowNodeData) =>
    nodes.push({ id: `${type}_${nodes.length}`, type, position: { x: 0, y: nodes.length * STEP_GAP }, data });

  if (startUrl && steps[0]?.action !== "goto") push("goto", { url: startUrl });
  for (const s of steps) {
    if (s.action === "goto" && s.url) push("goto", { url: s.url });
    else if (s.action === "click" && s.selector) push("click", { selector: s.selector });
    else if (s.action === "fill" && s.selector) push("fill", { selector: s.selector, value: s.value ?? "" });
    else if (s.action === "press" && s.key && (PRESS_KEYS as readonly string[]).includes(s.key)) push("press", { key: s.key as FlowNodeData["key"] });
  }
  push("end", {});

  const edges: FlowEdge[] = nodes.slice(1).map((n, i) => ({
    id: `e_${nodes[i].id}_${n.id}`,
    source: nodes[i].id,
    target: n.id,
    sourceHandle: "next",
  }));
  return { nodes, edges };
}

// ───────────── Kết quả chạy ─────────────

export type RunLogStatus = "running" | "ok" | "skipped" | "error";

export type RunLogEntry = {
  seq: number;
  nodeId: string;
  type: FlowNodeType;
  title: string;
  status: RunLogStatus;
  message: string;
  ms: number;
  screenshot?: string; // đường dẫn tương đối trong STORAGE_DIR
};

export type FlowRunResult = {
  phase: "login" | "running" | "done";
  ok?: boolean;
  error?: string;
  currentNodeId?: string | null;
  logs: RunLogEntry[];
  vars?: Record<string, string | number>;
};
