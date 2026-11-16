"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addEdge, Background, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow,
  type Connection, type Edge,
} from "@xyflow/react";
import {
  CircleAlert, CircleCheck, CircleX, FileJson, Info, LoaderCircle, Play, Save, ShieldAlert, Square, Trash2, TriangleAlert,
} from "lucide-react";
import {
  NODE_META, NODE_TYPES, newNodeId, stepsToGraph, validateFlow,
  type FlowGraph, type FlowNodeData, type FlowNodeType, type RunLogEntry, type RunLogStatus,
} from "@/lib/flow";
import { cancelFlowRun, deleteFlow, getFlowRun, saveFlow, startFlowRun, type FlowRunView } from "../actions";
import { COLOR_CLASSES, FlowNodeCard, InvalidNodesContext, NODE_ICONS, RunStatusContext, type EditorNode } from "./flow-node";
import { NodeInspector } from "./node-inspector";

type Account = { id: string; name: string; platformName: string; status: string };
type Props = {
  flow: { id: string; name: string; version: number; graph: FlowGraph };
  accounts: Account[];
  canWrite: boolean;
  canDelete: boolean;
};

const nodeTypes = Object.fromEntries(NODE_TYPES.map((t) => [t, FlowNodeCard]));
const PALETTE = NODE_TYPES.filter((t) => t !== "start");
const BUILTIN_VARS = ["username", "password", "tradeUrl", "loginUrl"];
const TERMINAL = new Set(["DONE", "FAILED", "CANCELLED"]);

function toEditorNodes(g: FlowGraph): EditorNode[] {
  return g.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data, deletable: n.type !== "start" }));
}

function edgeLabel(h?: string | null) {
  return h === "true" ? "Đúng" : h === "false" ? "Sai" : h === "up" ? "▲ TĂNG" : h === "down" ? "▼ GIẢM" : undefined;
}

function toEditorEdges(g: FlowGraph): Edge[] {
  return g.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? "next", label: edgeLabel(e.sourceHandle) }));
}

function serialize(name: string, nodes: EditorNode[], edges: Edge[]): { name: string; graph: FlowGraph } {
  return {
    name,
    graph: {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type as FlowNodeType,
        position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        data: n.data,
      })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? "next" })),
    },
  };
}

export function FlowEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  );
}

function Editor({ flow, accounts, canWrite, canDelete }: Props) {
  const rf = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);

  const [name, setName] = useState(flow.name);
  const [version, setVersion] = useState(flow.version);
  const [nodes, setNodes, onNodesChange] = useNodesState<EditorNode>(toEditorNodes(flow.graph));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(toEditorEdges(flow.graph));
  const [saved, setSaved] = useState(() => JSON.stringify(serialize(flow.name, toEditorNodes(flow.graph), toEditorEdges(flow.graph))));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ level: "success" | "error" | "info"; text: string } | null>(null);

  const [accountId, setAccountId] = useState(accounts.find((a) => a.status === "ACTIVE")?.id ?? accounts[0]?.id ?? "");
  const [dryRun, setDryRun] = useState(true);
  const [loginFirst, setLoginFirst] = useState(true);
  const [testDirection, setTestDirection] = useState<"UP" | "DOWN">("UP");
  const [run, setRun] = useState<{ commandId: string; dryRun: boolean; view: FlowRunView | null } | null>(null);
  const [preview, setPreview] = useState<RunLogEntry | null>(null);
  const [importText, setImportText] = useState("");
  const importRef = useRef<HTMLDialogElement>(null);

  const current = useMemo(() => serialize(name, nodes, edges), [name, nodes, edges]);
  const dirty = JSON.stringify(current) !== saved;
  const problems = useMemo(() => validateFlow(current.graph), [current]);
  const invalidIds = useMemo(() => new Set(problems.map((p) => p.nodeId).filter(Boolean) as string[]), [problems]);
  const selected = nodes.find((n) => n.selected);
  const hasCritical = nodes.some((n) => n.data.critical);
  const varNames = useMemo(
    () => [...BUILTIN_VARS.filter((v) => v !== "password"), ...nodes.map((n) => n.data.saveAs).filter(Boolean)] as string[],
    [nodes],
  );

  const running = !!run && !TERMINAL.has(run.view?.status ?? "PENDING");
  const runStatus = useMemo(() => {
    const map: Record<string, RunLogStatus> = {};
    for (const l of run?.view?.result?.logs ?? []) map[l.nodeId] = l.status;
    const cur = run?.view?.result?.currentNodeId;
    if (running && cur) map[cur] = "running";
    return map;
  }, [run, running]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  // Cảnh báo khi rời trang mà chưa lưu
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const flash = useCallback((level: "success" | "error" | "info", text: string) => {
    setNotice({ level, text });
    setTimeout(() => setNotice((n) => (n?.text === text ? null : n)), 5000);
  }, []);

  const save = useCallback(async () => {
    if (!canWrite) return false;
    setSaving(true);
    try {
      const res = await saveFlow(flow.id, current.name, current.graph);
      if (!res.ok) {
        flash("error", res.error ?? "Không lưu được");
        return false;
      }
      setSaved(JSON.stringify(current));
      setVersion(res.version!);
      flash(res.warnings?.length ? "info" : "success", res.warnings?.length ? `Đã lưu v${res.version} — còn ${res.warnings.length} vấn đề cần sửa trước khi chạy` : `Đã lưu phiên bản v${res.version}`);
      return true;
    } finally {
      setSaving(false);
    }
  }, [canWrite, current, flash, flow.id]);

  // Ctrl/Cmd + S
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [save]);

  const onConnect = useCallback(
    (c: Connection) => {
      const handle = c.sourceHandle ?? "next";
      setEdges((eds) =>
        addEdge(
          { ...c, sourceHandle: handle, id: `e_${c.source}_${handle}_${c.target}`, label: edgeLabel(handle) },
          // mỗi đầu ra chỉ nối tới 1 khối
          eds.filter((e) => !(e.source === c.source && (e.sourceHandle ?? "next") === handle)),
        ),
      );
    },
    [setEdges],
  );

  const addNode = useCallback(
    (type: FlowNodeType, at?: { x: number; y: number }) => {
      const id = newNodeId(type);
      const sel = nodes.find((n) => n.selected);
      let position = at;
      let linkFrom: EditorNode | undefined;
      if (!position && sel && sel.type !== "end" && sel.type !== "condition" && sel.type !== "direction") {
        position = { x: sel.position.x, y: sel.position.y + 130 };
        if (!edges.some((e) => e.source === sel.id && (e.sourceHandle ?? "next") === "next")) linkFrom = sel;
      }
      if (!position) {
        const r = wrapperRef.current?.getBoundingClientRect();
        position = r ? rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : { x: 0, y: 0 };
      }
      const data: FlowNodeData = type === "wait" ? { ms: 1000 } : type === "readText" ? { parse: "number" } : {};
      setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id, type, position, data, selected: true, deletable: true }]);
      if (linkFrom) {
        const from = linkFrom;
        // chèn vào giữa: from → new → (đích cũ của from nếu có thì đã không tồn tại)
        setEdges((es) => [...es, { id: `e_${from.id}_next_${id}`, source: from.id, target: id, sourceHandle: "next" }]);
      }
    },
    [edges, nodes, rf, setEdges, setNodes],
  );

  const updateSelected = (patch: Partial<FlowNodeData>) => {
    if (!selected) return;
    setNodes((ns) =>
      ns.map((n) => {
        if (n.id !== selected.id) return n;
        const data = { ...n.data, ...patch };
        for (const k of Object.keys(data) as (keyof FlowNodeData)[]) if (data[k] === undefined) delete data[k];
        return { ...n, data };
      }),
    );
  };

  const deleteSelected = () => {
    if (!selected || selected.type === "start") return;
    setNodes((ns) => ns.filter((n) => n.id !== selected.id));
    setEdges((es) => es.filter((e) => e.source !== selected.id && e.target !== selected.id));
  };

  const poll = async (commandId: string) => {
    for (;;) {
      const view = await getFlowRun(commandId);
      if (!aliveRef.current) return;
      setRun((r) => (r && r.commandId === commandId ? { ...r, view } : r));
      if (!view || TERMINAL.has(view.status)) return;
      await new Promise((resolve) => {
        pollRef.current = setTimeout(resolve, 700);
      });
    }
  };

  const startRun = async () => {
    if (!accountId) return flash("error", "Chưa chọn tài khoản để chạy");
    if (problems.length) return flash("error", `Flow chưa hợp lệ: ${problems[0].message}`);
    if (dryRun && !hasCritical && nodes.some((n) => n.type === "click" || n.type === "press") &&
      !window.confirm("Chưa có khối nào được đánh dấu “Thao tác đặt lệnh”, chạy thử vẫn sẽ bấm mọi nút. Vẫn chạy?")) return;
    if (!dryRun && !window.confirm("Chạy THẬT sẽ bấm cả các khối “Thao tác đặt lệnh”. Chỉ dùng với sàn giả lập hoặc khi bạn chắc chắn. Tiếp tục?")) return;
    if (dirty && !(await save())) return;
    let res: Awaited<ReturnType<typeof startFlowRun>>;
    try {
      res = await startFlowRun({ flowId: flow.id, accountId, dryRun, loginFirst, direction: testDirection });
    } catch {
      return flash("error", "Server lỗi khi tạo lệnh chạy. Xem log của Next.js để biết chi tiết.");
    }
    if (!res.commandId) return flash("error", res.error ?? "Không chạy được");
    setRun({ commandId: res.commandId, dryRun, view: null });
    poll(res.commandId);
  };

  const importSteps = () => {
    try {
      const steps = JSON.parse(importText);
      if (!Array.isArray(steps)) throw new Error("JSON phải là một mảng các bước");
      const g = stepsToGraph(steps);
      // đặt các khối mới sang phải flow hiện tại, nối từ Bắt đầu nếu Bắt đầu chưa nối
      const offsetX = Math.max(0, ...nodes.map((n) => n.position.x)) + 360;
      const prefix = `imp${Date.now().toString(36)}_`;
      const newNodes = g.nodes
        .filter((n) => n.type !== "start" && n.type !== "end")
        .map((n) => ({ ...n, id: prefix + n.id, position: { x: n.position.x + offsetX, y: n.position.y }, deletable: true }));
      if (!newNodes.length) throw new Error("Không có bước hợp lệ nào");
      const newEdges = newNodes.slice(1).map((n, i) => ({ id: `e_${newNodes[i].id}_next_${n.id}`, source: newNodes[i].id, target: n.id, sourceHandle: "next" }));
      setNodes((ns) => [...ns, ...newNodes]);
      setEdges((es) => [...es, ...newEdges]);
      importRef.current?.close();
      setImportText("");
      flash("success", `Đã thêm ${newNodes.length} khối — hãy nối chúng vào flow`);
    } catch (e) {
      flash("error", `Không nhập được: ${(e as Error).message}`);
    }
  };

  const result = run?.view?.result;

  return (
    <div className="space-y-4">
      {/* ───── Thanh công cụ ───── */}
      <div className="card bg-base-100 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <input
            className="input input-ghost min-w-56 flex-1 text-lg font-bold"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canWrite}
            aria-label="Tên flow"
          />
          <span className="badge badge-ghost">v{version}</span>
          {dirty ? <span className="badge badge-warning badge-soft">Chưa lưu</span> : <span className="badge badge-success badge-soft">Đã lưu</span>}
          {problems.length > 0 && (
            <div className="dropdown dropdown-end">
              <button tabIndex={0} className="btn btn-sm btn-ghost text-error">
                <TriangleAlert className="size-4" /> {problems.length} vấn đề
              </button>
              <ul tabIndex={0} className="dropdown-content menu z-50 w-96 rounded-box bg-base-100 p-2 shadow-lg">
                {problems.map((p, i) => (
                  <li key={i}>
                    <button
                      onClick={() => p.nodeId && setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === p.nodeId })))}
                      className="text-left text-sm whitespace-normal"
                    >
                      {p.message}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {canWrite && (
            <>
              <button className="btn btn-sm btn-ghost" onClick={() => importRef.current?.showModal()}>
                <FileJson className="size-4" /> Nhập bước (JSON)
              </button>
              <button className="btn btn-sm btn-primary" disabled={!dirty || saving} onClick={save}>
                {saving ? <span className="loading loading-spinner loading-xs" /> : <Save className="size-4" />} Lưu
                <kbd className="kbd kbd-xs hidden sm:inline">⌘S</kbd>
              </button>
            </>
          )}
          {canDelete && (
            <button
              className="btn btn-sm btn-ghost btn-square text-error"
              aria-label="Xoá flow"
              onClick={async () => {
                if (!window.confirm(`Xoá flow “${name}”? Không thể hoàn tác.`)) return;
                const r = await deleteFlow(flow.id);
                if (r && !r.ok) flash("error", r.error ?? "Không xoá được");
              }}
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>

        {/* Chạy thử */}
        <div className="flex flex-wrap items-center gap-3 border-t border-base-300 px-3 py-2">
          <span className="text-sm font-semibold">Chạy trên</span>
          <select className="select select-sm w-60" value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={running}>
            {accounts.length === 0 && <option value="">Chưa có tài khoản</option>}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} — {a.platformName}
              </option>
            ))}
          </select>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="toggle toggle-sm toggle-success" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} disabled={running} />
            Chạy thử (không đặt lệnh)
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="checkbox checkbox-sm" checked={loginFirst} onChange={(e) => setLoginFirst(e.target.checked)} disabled={running} />
            Đăng nhập trước
          </label>
          <label className="flex items-center gap-2 text-sm">
            Hướng thử
            <select
              className="select select-sm w-28"
              value={testDirection}
              onChange={(e) => setTestDirection(e.target.value as "UP" | "DOWN")}
              disabled={running}
              title="Giá trị {{direction}} khi chạy thử flow. Khi bot chạy, hướng do chiến lược/AI quyết định."
            >
              <option value="UP">▲ TĂNG</option>
              <option value="DOWN">▼ GIẢM</option>
            </select>
          </label>
          <div className="ml-auto">
            {running ? (
              <button className="btn btn-sm btn-error" onClick={() => run && cancelFlowRun(run.commandId)}>
                <Square className="size-4" /> Dừng
              </button>
            ) : (
              <button className={`btn btn-sm ${dryRun ? "btn-success" : "btn-warning"}`} onClick={startRun} disabled={!canWrite || !accountId}>
                <Play className="size-4" /> {dryRun ? "Chạy thử" : "Chạy thật"}
              </button>
            )}
          </div>
        </div>
        {dryRun && !hasCritical && nodes.some((n) => n.type === "click" || n.type === "press") && (
          <div className="alert alert-warning alert-soft rounded-none border-x-0 border-b-0 py-2 text-sm">
            <ShieldAlert className="size-4" /> Chưa có khối nào được đánh dấu “Thao tác đặt lệnh” — chạy thử vẫn sẽ bấm MỌI nút. Hãy đánh dấu các nút TĂNG/GIẢM/Xác nhận.
          </div>
        )}
        {!dryRun && (
          <div className="alert alert-warning alert-soft rounded-none border-x-0 border-b-0 py-2 text-sm">
            <ShieldAlert className="size-4" /> Chế độ chạy thật sẽ bấm cả các khối “Thao tác đặt lệnh”. Chỉ dùng với sàn giả lập hoặc khi bạn chắc chắn.
          </div>
        )}
      </div>

      {notice && (
        <div role="alert" className={`alert alert-soft ${notice.level === "success" ? "alert-success" : notice.level === "error" ? "alert-error" : "alert-info"}`}>
          {notice.level === "success" ? <CircleCheck className="size-5" /> : notice.level === "error" ? <CircleAlert className="size-5" /> : <Info className="size-5" />}
          <span>{notice.text}</span>
        </div>
      )}

      {/* ───── Palette | Canvas | Inspector ───── */}
      <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)_320px]">
        <div className="card h-fit bg-base-100 shadow-sm">
          <div className="card-body gap-1 p-3">
            <div className="mb-1 text-xs font-semibold text-base-content/60">THÊM KHỐI</div>
            {PALETTE.map((t) => {
              const Icon = NODE_ICONS[t];
              return (
                <button
                  key={t}
                  draggable={canWrite}
                  disabled={!canWrite}
                  onDragStart={(e) => e.dataTransfer.setData("application/x-flow-node", t)}
                  onClick={() => addNode(t)}
                  className="flex items-center gap-2 rounded-field p-1.5 text-left text-sm hover:bg-base-200 disabled:opacity-50"
                  title={NODE_META[t].desc}
                >
                  <span className={`grid size-7 place-items-center rounded-field ${COLOR_CLASSES[NODE_META[t].color]}`}>
                    <Icon className="size-3.5" />
                  </span>
                  {NODE_META[t].label}
                </button>
              );
            })}
            <p className="mt-2 text-[11px] text-base-content/50">Click để thêm ngay dưới khối đang chọn, hoặc kéo thả vào sơ đồ.</p>
          </div>
        </div>

        <div
          ref={wrapperRef}
          className="card h-[70vh] min-h-[480px] overflow-hidden bg-base-100 shadow-sm"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }}
          onDrop={(e) => {
            e.preventDefault();
            const t = e.dataTransfer.getData("application/x-flow-node") as FlowNodeType;
            if (t && (NODE_TYPES as readonly string[]).includes(t)) addNode(t, rf.screenToFlowPosition({ x: e.clientX - 128, y: e.clientY - 24 }));
          }}
        >
          <RunStatusContext.Provider value={runStatus}>
            <InvalidNodesContext.Provider value={invalidIds}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                nodesDraggable={canWrite}
                nodesConnectable={canWrite}
                elementsSelectable
                deleteKeyCode={canWrite ? ["Backspace", "Delete"] : null}
                defaultEdgeOptions={{ type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed }, style: { strokeWidth: 2 } }}
                colorMode="system"
                fitView
                fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
              >
                <Background gap={20} />
                <Controls showInteractive={false} />
                <MiniMap pannable zoomable className="!hidden md:!block" />
              </ReactFlow>
            </InvalidNodesContext.Provider>
          </RunStatusContext.Provider>
        </div>

        <aside className="card h-fit bg-base-100 shadow-sm">
          <div className="card-body p-4">
            {selected ? (
              <NodeInspector node={selected} varNames={varNames} readOnly={!canWrite} onChange={updateSelected} onDelete={deleteSelected} />
            ) : (
              <div className="space-y-3 text-sm">
                <div className="font-semibold">Hướng dẫn</div>
                <ul className="list-disc space-y-1 pl-5 text-base-content/70">
                  <li>Click một khối để sửa thuộc tính.</li>
                  <li>Kéo từ chấm dưới khối sang khối khác để nối.</li>
                  <li>Khối <b>Điều kiện</b> có 2 nhánh: <span className="text-success">Đúng</span> / <span className="text-error">Sai</span>. Nối ngược lên trên để tạo vòng lặp.</li>
                  <li>Đánh dấu <b>Thao tác đặt lệnh</b> cho nút TĂNG/GIẢM để chạy thử an toàn.</li>
                  <li>Chọn khối rồi nhấn <kbd className="kbd kbd-xs">Delete</kbd> để xoá.</li>
                </ul>
                <div className="font-semibold">Biến có sẵn</div>
                <div className="flex flex-wrap gap-1">
                  {[...BUILTIN_VARS, ...varNames.filter((v) => !BUILTIN_VARS.includes(v))].map((v) => (
                    <code key={v} className="badge badge-ghost badge-sm">{`{{${v}}}`}</code>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* ───── Kết quả chạy ───── */}
      {run && (
        <div className="card bg-base-100 shadow-sm">
          <div className="card-body gap-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="card-title text-base">Kết quả chạy {payloadLabel(run.dryRun)}</h2>
              <RunBadge view={run.view} />
              {run.view?.status === "PENDING" && run.view.ageSec > 8 && (
                <span className="text-sm text-warning">Lệnh đang chờ worker. Worker đã chạy chưa? (npm run worker)</span>
              )}
            </div>
            {result?.error && (
              <div role="alert" className={`alert alert-soft ${result.cancelled ? "alert-warning" : "alert-error"}`}>
                <CircleX className="size-5" />
                <span>{result.error}</span>
              </div>
            )}
            {result?.ok && (
              <div role="alert" className="alert alert-success alert-soft">
                <CircleCheck className="size-5" />
                <span>Flow chạy xong {result.logs.length} bước không lỗi.</span>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Khối</th>
                    <th>Kết quả</th>
                    <th className="text-right">Thời gian</th>
                    <th>Ảnh</th>
                  </tr>
                </thead>
                <tbody>
                  {(result?.logs ?? []).map((l) => (
                    <tr
                      key={`${l.seq}-${l.nodeId}`}
                      className="cursor-pointer hover:bg-base-200/50"
                      onClick={() => setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === l.nodeId })))}
                    >
                      <td>{l.seq === 9999 ? "!" : l.seq}</td>
                      <td className="whitespace-nowrap">
                        <StatusIcon status={l.status} /> {l.title}
                      </td>
                      <td className="max-w-md truncate font-mono text-xs" title={l.message}>
                        {l.message}
                      </td>
                      <td className="text-right text-xs">{l.ms ? (l.ms < 1000 ? `${l.ms}ms` : `${(l.ms / 1000).toFixed(1)}s`) : ""}</td>
                      <td>
                        {l.screenshot && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreview(l);
                            }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/files?path=${encodeURIComponent(l.screenshot)}`} alt="" className="h-10 rounded border border-base-300" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {running && (
                    <tr>
                      <td colSpan={5} className="text-sm text-base-content/60">
                        <LoaderCircle className="mr-2 inline size-4 animate-spin" />
                        {result?.phase === "login" || !result ? "Đang mở trình duyệt & đăng nhập..." : "Đang chạy..."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {result?.vars && Object.keys(result.vars).length > 0 && (
              <div className="flex flex-wrap gap-2 text-sm">
                <span className="font-semibold">Biến:</span>
                {Object.entries(result.vars).map(([k, v]) => (
                  <code key={k} className="badge badge-ghost">
                    {k} = {typeof v === "number" ? v.toLocaleString("vi-VN") : String(v).slice(0, 60)}
                  </code>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ───── Xem ảnh lớn ───── */}
      <dialog className={`modal ${preview ? "modal-open" : ""}`} onClick={() => setPreview(null)}>
        {preview?.screenshot && (
          <div className="modal-box max-w-5xl p-2">
            <div className="p-2 text-sm font-semibold">
              {preview.seq}. {preview.title} — <span className="font-normal">{preview.message}</span>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/files?path=${encodeURIComponent(preview.screenshot)}`} alt={preview.title} className="w-full rounded" />
          </div>
        )}
      </dialog>

      {/* ───── Nhập bước JSON ───── */}
      <dialog ref={importRef} className="modal">
        <div className="modal-box max-w-2xl">
          <h3 className="text-lg font-bold">Nhập các bước (JSON)</h3>
          <p className="py-2 text-sm text-base-content/60">
            Dán JSON từ nút <b>Sao chép JSON</b> trong Trình duyệt trực tiếp. Các khối sẽ được thêm bên phải sơ đồ.
          </p>
          <textarea className="textarea h-56 w-full font-mono text-xs" value={importText} onChange={(e) => setImportText(e.target.value)} placeholder='[{"action":"click","selector":"#btn-up"}]' />
          <div className="modal-action">
            <button className="btn btn-ghost" onClick={() => importRef.current?.close()}>
              Huỷ
            </button>
            <button className="btn btn-primary" onClick={importSteps} disabled={!importText.trim()}>
              Nhập
            </button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </div>
  );
}

function payloadLabel(dryRun: boolean) {
  return dryRun ? "(chạy thử)" : "(chạy thật)";
}

function StatusIcon({ status }: { status: RunLogStatus }) {
  if (status === "ok") return <CircleCheck className="inline size-4 text-success" />;
  if (status === "skipped") return <ShieldAlert className="inline size-4 text-warning" />;
  if (status === "error") return <CircleX className="inline size-4 text-error" />;
  return <LoaderCircle className="inline size-4 animate-spin text-primary" />;
}

function RunBadge({ view }: { view: FlowRunView | null }) {
  const s = view?.status ?? "PENDING";
  const map: Record<string, [string, string]> = {
    PENDING: ["Đang chờ worker", "badge-ghost"],
    PROCESSING: ["Đang chạy", "badge-info"],
    DONE: ["Thành công", "badge-success"],
    FAILED: ["Lỗi", "badge-error"],
    CANCELLED: ["Đã dừng", "badge-warning"],
  };
  return <span className={`badge badge-soft ${map[s][1]}`}>{map[s][0]}</span>;
}
