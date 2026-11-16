"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, CircleDot, ClipboardCopy, Crosshair, Hand, LogIn, MousePointerClick,
  RefreshCw, RotateCw, Save, Search, Trash2, Wifi, WifiOff,
} from "lucide-react";
import {
  ASSIGNABLE_FIELDS, CLOSE_CODES,
  type AssignableField, type ClientMsg, type LiveMode, type PickedElement, type Rect, type RecordedStep, type ServerMsg,
} from "@/lib/live-protocol";
import { useRouter } from "next/navigation";
import { Workflow } from "lucide-react";
import { assignSelector, createLiveBrowserToken } from "../../worker-actions";
import { createFlowFromSteps } from "../../../flows/actions";

type Account = {
  id: string;
  name: string;
  loginMethod: "FORM" | "SESSION";
  viewportWidth: number;
  viewportHeight: number;
  hasSession: boolean;
} & Record<AssignableField, string | null>;

type Conn = { state: "connecting" | "open" | "closed"; reason?: string };
type Toast = { id: number; level: "info" | "success" | "error"; message: string };

const SPECIAL_KEYS = new Set([
  "Enter", "Backspace", "Tab", "Escape", "Delete", "Home", "End", "PageUp", "PageDown",
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
]);

export function LiveBrowser({ account }: { account: Account }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const lastMove = useRef(0);
  const decoding = useRef(false);
  const pendingFrame = useRef<Blob | null>(null);
  const recordStartUrl = useRef<string | null>(null);
  const router = useRouter();
  const [creatingFlow, setCreatingFlow] = useState(false);

  const [attempt, setAttempt] = useState(0);
  const [conn, setConn] = useState<Conn>({ state: "connecting" });
  const [hasFrame, setHasFrame] = useState(false);
  const [scale, setScale] = useState(1);
  const [url, setUrl] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [mode, setMode] = useState<LiveMode>("interact");
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState<Rect | null>(null);
  const [highlight, setHighlight] = useState<Rect | null>(null);
  const [picked, setPicked] = useState<PickedElement | null>(null);
  const [chosen, setChosen] = useState("");
  const [field, setField] = useState<AssignableField>("usernameSelector");
  const [steps, setSteps] = useState<RecordedStep[]>([]);
  const [tab, setTab] = useState<"element" | "steps" | "selectors">("element");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [selectors, setSelectors] = useState<Record<AssignableField, string | null>>(() => ({
    usernameSelector: account.usernameSelector,
    passwordSelector: account.passwordSelector,
    submitSelector: account.submitSelector,
    successSelector: account.successSelector,
    balanceSelector: account.balanceSelector,
  }));
  const [testResult, setTestResult] = useState<{ selector: string; count: number; error?: string } | null>(null);

  const toast = useCallback((level: Toast["level"], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, level, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const send = useCallback((msg: ClientMsg) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const reconnect = () => {
    setConn({ state: "connecting" });
    setHasFrame(false);
    setAttempt((a) => a + 1);
  };

  const onServerMsg = useCallback(
    (msg: ServerMsg) => {
      switch (msg.t) {
        case "ready":
          setConn({ state: "open" });
          break;
        case "url":
          setUrl(msg.url);
          setUrlInput(msg.url);
          break;
        case "hover":
          setHover(msg.rect);
          break;
        case "picked":
          setPicked(msg.element);
          setChosen(msg.element.selectors[0]?.selector ?? "");
          setTab("element");
          break;
        case "step":
          setSteps((s) => [...s, msg.step]);
          break;
        case "selectorTest":
          setTestResult({ selector: msg.selector, count: msg.count, error: msg.error });
          setHighlight(msg.rect);
          setTimeout(() => setHighlight(null), 2500);
          break;
        case "toast":
          toast(msg.level, msg.message);
          break;
        case "busy":
          setBusy(msg.busy);
          break;
      }
    },
    [toast],
  );

  // Kết nối WebSocket tới worker
  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;

    // Vẽ khung hình mới nhất (bỏ qua khung cũ nếu đang giải mã)
    const drawFrame = async (blob: Blob) => {
      if (decoding.current) {
        pendingFrame.current = blob;
        return;
      }
      decoding.current = true;
      try {
        const bitmap = await createImageBitmap(blob);
        const canvas = canvasRef.current;
        canvas?.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        if (!cancelled) setHasFrame(true);
      } catch {
        /* khung hỏng → bỏ qua */
      } finally {
        decoding.current = false;
        const next = pendingFrame.current;
        pendingFrame.current = null;
        if (next && !cancelled) drawFrame(next);
      }
    };

    (async () => {
      try {
        const { wsUrl, token } = await createLiveBrowserToken(account.id);
        if (cancelled) return;
        ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);
        ws.binaryType = "blob";
        wsRef.current = ws;
        ws.onmessage = (ev) => {
          if (ev.data instanceof Blob) drawFrame(ev.data);
          else onServerMsg(JSON.parse(ev.data));
        };
        ws.onclose = (ev) => {
          if (cancelled) return;
          setConn({
            state: "closed",
            reason:
              CLOSE_CODES[ev.code] ??
              (ev.code === 1006 ? "Không kết nối được worker. Hãy chắc chắn worker đang chạy (npm run worker)." : "Mất kết nối tới worker."),
          });
        };
      } catch (e) {
        if (!cancelled) setConn({ state: "closed", reason: (e as Error).message });
      }
    })();

    return () => {
      cancelled = true;
      ws?.close();
      wsRef.current = null;
    };
  }, [account.id, attempt, onServerMsg]);

  // Tỉ lệ canvas hiển thị / kích thước viewport thật (để vẽ khung highlight)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => setScale(canvas.clientWidth / canvas.width));
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // Cuộn chuột (cần listener non-passive để chặn cuộn trang dashboard)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toPage(canvas, e.clientX, e.clientY);
      send({ t: "wheel", ...p, dx: e.deltaX, dy: e.deltaY });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [send]);

  const changeMode = (m: LiveMode) => {
    // Ghi nhớ URL lúc bắt đầu ghi để flow mở đúng trang trước bước đầu tiên
    if (m === "record" && steps.length === 0) recordStartUrl.current = url || null;
    setMode(m);
    send({ t: "mode", mode: m });
    setHover(null);
    canvasRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (mode === "pick") return;
    if (e.metaKey || e.ctrlKey) {
      if (e.key === "a") {
        e.preventDefault();
        send({ t: "key", key: "Control+a" });
      }
      if (e.key === "v") {
        e.preventDefault();
        navigator.clipboard?.readText().then((text) => text && send({ t: "text", text }), () => toast("error", "Trình duyệt chặn đọc clipboard"));
      }
      return;
    }
    if (e.key.length === 1) {
      e.preventDefault();
      send({ t: "text", text: e.key });
    } else if (SPECIAL_KEYS.has(e.key)) {
      e.preventDefault();
      send({ t: "key", key: e.key });
    }
  };

  const assign = async () => {
    if (!chosen) return;
    const res = await assignSelector(account.id, field, chosen);
    if (res.ok) {
      setSelectors((s) => ({ ...s, [field]: chosen }));
      toast("success", `Đã gán “${ASSIGNABLE_FIELDS[field]}” = ${chosen}`);
    } else toast("error", res.error ?? "Không lưu được");
  };

  const copySteps = async () => {
    const data = steps.map(({ action, selector, value, url, key }) => ({ action, selector, value, url, key }));
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    toast("success", "Đã sao chép các bước (JSON)");
  };

  const createFlow = async () => {
    setCreatingFlow(true);
    try {
      const { id } = await createFlowFromSteps(account.id, steps, recordStartUrl.current ?? undefined);
      router.push(`/flows/${id}`);
    } catch (e) {
      toast("error", (e as Error).message);
      setCreatingFlow(false);
    }
  };

  const open = conn.state === "open";

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      {/* ───── Trình duyệt ───── */}
      <div className="card overflow-hidden bg-base-100 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-base-300 p-2">
          <div className="join">
            <button className="btn join-item btn-ghost btn-sm btn-square" disabled={!open} onClick={() => send({ t: "back" })} aria-label="Quay lại">
              <ArrowLeft className="size-4" />
            </button>
            <button className="btn join-item btn-ghost btn-sm btn-square" disabled={!open} onClick={() => send({ t: "forward" })} aria-label="Tiến tới">
              <ArrowRight className="size-4" />
            </button>
            <button className="btn join-item btn-ghost btn-sm btn-square" disabled={!open} onClick={() => send({ t: "reload" })} aria-label="Tải lại">
              <RotateCw className="size-4" />
            </button>
          </div>
          <form
            className="join min-w-60 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              send({ t: "navigate", url: urlInput });
            }}
          >
            <input
              className="input input-sm join-item w-full font-mono text-xs"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://..."
              disabled={!open}
            />
            <button className="btn btn-sm join-item" disabled={!open}>
              Đi
            </button>
          </form>
          <div className="join">
            <ModeButton active={mode === "interact"} onClick={() => changeMode("interact")} icon={<Hand className="size-4" />} label="Tương tác" />
            <ModeButton active={mode === "pick"} onClick={() => changeMode("pick")} icon={<Crosshair className="size-4" />} label="Chọn phần tử" />
            <ModeButton
              active={mode === "record"}
              danger
              onClick={() => changeMode("record")}
              icon={<CircleDot className={`size-4 ${mode === "record" ? "animate-pulse" : ""}`} />}
              label="Ghi thao tác"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-base-300 px-3 py-2 text-sm">
          {conn.state === "open" ? (
            <span className="badge badge-success badge-soft gap-1">
              <Wifi className="size-3" /> Đã kết nối
            </span>
          ) : conn.state === "connecting" ? (
            <span className="badge badge-ghost gap-1">
              <span className="loading loading-spinner loading-xs" /> Đang mở trình duyệt...
            </span>
          ) : (
            <span className="badge badge-error badge-soft gap-1">
              <WifiOff className="size-3" /> Mất kết nối
            </span>
          )}
          {account.hasSession && <span className="badge badge-ghost">Có phiên đã lưu</span>}
          <span className="hidden min-w-0 flex-1 truncate text-base-content/50 md:block">{url}</span>
          <div className="ml-auto flex gap-2">
            {account.loginMethod === "FORM" && (
              <button className="btn btn-sm btn-outline" disabled={!open || busy} onClick={() => send({ t: "autoLogin" })}>
                {busy ? <span className="loading loading-spinner loading-xs" /> : <LogIn className="size-4" />}
                Tự đăng nhập
              </button>
            )}
            <button className="btn btn-sm btn-success" disabled={!open} onClick={() => send({ t: "saveSession" })}>
              <Save className="size-4" /> Lưu phiên đăng nhập
            </button>
          </div>
        </div>

        <div className="relative bg-base-300">
          <canvas
            ref={canvasRef}
            width={account.viewportWidth}
            height={account.viewportHeight}
            tabIndex={0}
            className={`block h-auto w-full outline-none focus:ring-2 focus:ring-primary/40 ${mode === "pick" ? "cursor-crosshair" : "cursor-default"}`}
            onMouseMove={(e) => {
              const now = Date.now();
              if (now - lastMove.current < 80) return;
              lastMove.current = now;
              send({ t: "move", ...toPage(e.currentTarget, e.clientX, e.clientY) });
            }}
            onMouseLeave={() => setHover(null)}
            onClick={(e) => {
              e.currentTarget.focus();
              send({ t: "click", ...toPage(e.currentTarget, e.clientX, e.clientY), detail: e.detail || 1 });
            }}
            onKeyDown={onKeyDown}
            onContextMenu={(e) => e.preventDefault()}
          />
          {hover && mode === "pick" && <Overlay rect={hover} scale={scale} className="border-primary bg-primary/15" />}
          {highlight && <Overlay rect={highlight} scale={scale} className="border-warning bg-warning/20" />}

          {!hasFrame && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center">
              {conn.state === "closed" ? (
                <div className="max-w-md space-y-3">
                  <WifiOff className="mx-auto size-10 text-error" />
                  <p>{conn.reason}</p>
                  <button className="btn btn-primary btn-sm" onClick={reconnect}>
                    <RefreshCw className="size-4" /> Kết nối lại
                  </button>
                </div>
              ) : (
                <span className="loading loading-dots loading-lg text-primary" />
              )}
            </div>
          )}
          {hasFrame && conn.state === "closed" && (
            <div className="absolute inset-x-0 top-0 flex items-center justify-center gap-3 bg-error/90 p-2 text-sm text-error-content">
              {conn.reason}
              <button className="btn btn-xs" onClick={reconnect}>
                Kết nối lại
              </button>
            </div>
          )}
        </div>
        <div className="px-3 py-2 text-xs text-base-content/50">
          Click vào khung để gõ phím. {mode === "pick" && "Chế độ Chọn phần tử: click không tác động lên trang, chỉ lấy selector."}
          {mode === "record" && " Đang ghi: mỗi click / nội dung gõ / Enter được lưu thành 1 bước."}
        </div>
      </div>

      {/* ───── Panel bên phải ───── */}
      <aside className="card h-fit bg-base-100 shadow-sm">
        <div className="card-body gap-4 p-4">
          <div role="tablist" className="tabs-box tabs tabs-sm">
            <button role="tab" className={`tab ${tab === "element" ? "tab-active" : ""}`} onClick={() => setTab("element")}>
              Phần tử
            </button>
            <button role="tab" className={`tab ${tab === "steps" ? "tab-active" : ""}`} onClick={() => setTab("steps")}>
              Thao tác {steps.length > 0 && <span className="badge badge-xs badge-primary ml-1">{steps.length}</span>}
            </button>
            <button role="tab" className={`tab ${tab === "selectors" ? "tab-active" : ""}`} onClick={() => setTab("selectors")}>
              Selector
            </button>
          </div>

          {tab === "element" &&
            (!picked ? (
              <div className="py-6 text-center text-sm text-base-content/60">
                <MousePointerClick className="mx-auto mb-2 size-8 opacity-50" />
                Bật <b>Chọn phần tử</b> rồi click vào nút / ô nhập / số dư trên trang để lấy selector.
                {mode !== "pick" && (
                  <button className="btn btn-primary btn-sm mt-3" onClick={() => changeMode("pick")}>
                    <Crosshair className="size-4" /> Bật chọn phần tử
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-box bg-base-200 p-3 text-sm">
                  <code className="text-primary">
                    &lt;{picked.tag}
                    {picked.type ? ` type="${picked.type}"` : ""}&gt;
                  </code>
                  {picked.text && <div className="mt-1 truncate text-base-content/70">“{picked.text}”</div>}
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-semibold">Selector gợi ý</div>
                  {picked.selectors.length === 0 && <p className="text-sm text-warning">Không tạo được selector ổn định.</p>}
                  {picked.selectors.map((s) => (
                    <label key={s.selector} className="flex cursor-pointer items-start gap-2 rounded-field p-1.5 hover:bg-base-200">
                      <input type="radio" className="radio radio-xs radio-primary mt-1" checked={chosen === s.selector} onChange={() => setChosen(s.selector)} />
                      <code className="flex-1 break-all text-xs">{s.selector}</code>
                      <span className={`badge badge-xs ${s.count === 1 ? "badge-success" : "badge-warning"} badge-soft shrink-0`}>
                        {s.count === 1 ? "duy nhất" : `${s.count} phần tử`}
                      </span>
                    </label>
                  ))}
                </div>
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">Selector sẽ dùng</legend>
                  <input className="input input-sm w-full font-mono text-xs" value={chosen} onChange={(e) => setChosen(e.target.value)} />
                </fieldset>
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">Gán cho</legend>
                  <select className="select select-sm w-full" value={field} onChange={(e) => setField(e.target.value as AssignableField)}>
                    {Object.entries(ASSIGNABLE_FIELDS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </fieldset>
                <div className="flex gap-2">
                  <button className="btn btn-sm btn-ghost flex-1" disabled={!chosen} onClick={() => send({ t: "testSelector", selector: chosen })}>
                    <Search className="size-4" /> Thử
                  </button>
                  <button className="btn btn-sm btn-primary flex-1" disabled={!chosen} onClick={assign}>
                    Gán selector
                  </button>
                </div>
                {testResult && testResult.selector === chosen && <TestResultBadge result={testResult} />}
              </div>
            ))}

          {tab === "steps" && (
            <div className="space-y-3">
              {steps.length === 0 ? (
                <div className="py-6 text-center text-sm text-base-content/60">
                  <CircleDot className="mx-auto mb-2 size-8 opacity-50" />
                  Bật <b>Ghi thao tác</b> rồi thao tác trên trang. Các bước sẽ được dùng để dựng Flow ở giai đoạn 3.
                </div>
              ) : (
                <ol className="max-h-[480px] space-y-2 overflow-y-auto">
                  {steps.map((s, i) => (
                    <li key={s.id} className="group flex gap-2 rounded-box border border-base-300 p-2 text-sm">
                      <span className="badge badge-sm badge-neutral shrink-0">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          <span className="badge badge-xs badge-primary badge-soft uppercase">{s.action}</span>
                          <span className="truncate">{s.label}</span>
                        </div>
                        {s.selector && <code className="block truncate text-xs text-base-content/60">{s.selector}</code>}
                        {s.value != null && <code className="block truncate text-xs text-secondary">= {s.value}</code>}
                      </div>
                      <button
                        className="btn btn-ghost btn-xs btn-square opacity-0 group-hover:opacity-100"
                        onClick={() => setSteps((all) => all.filter((x) => x.id !== s.id))}
                        aria-label="Xoá bước"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              <div className="flex gap-2">
                <button className="btn btn-sm btn-ghost flex-1" disabled={!steps.length} onClick={() => setSteps([])}>
                  <Trash2 className="size-4" /> Xoá hết
                </button>
                <button className="btn btn-sm flex-1" disabled={!steps.length} onClick={copySteps}>
                  <ClipboardCopy className="size-4" /> Sao chép JSON
                </button>
              </div>
              <button className="btn btn-sm btn-primary w-full" disabled={!steps.length || creatingFlow} onClick={createFlow}>
                {creatingFlow ? <span className="loading loading-spinner loading-xs" /> : <Workflow className="size-4" />}
                Tạo Flow từ {steps.length} bước
              </button>
            </div>
          )}

          {tab === "selectors" && (
            <div className="space-y-2">
              <p className="text-xs text-base-content/60">Selector đang cấu hình cho tài khoản. Bấm “Thử” để tô sáng phần tử trên trang.</p>
              {(Object.keys(ASSIGNABLE_FIELDS) as AssignableField[]).map((k) => (
                <div key={k} className="rounded-box border border-base-300 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{ASSIGNABLE_FIELDS[k]}</span>
                    <button className="btn btn-ghost btn-xs" disabled={!selectors[k] || !open} onClick={() => send({ t: "testSelector", selector: selectors[k]! })}>
                      <Search className="size-3.5" /> Thử
                    </button>
                  </div>
                  {selectors[k] ? (
                    <code className="block break-all text-xs text-base-content/70">{selectors[k]}</code>
                  ) : (
                    <span className="text-xs text-warning">Chưa đặt</span>
                  )}
                  {testResult && testResult.selector === selectors[k] && <TestResultBadge result={testResult} />}
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      <div className="toast toast-end toast-bottom z-50">
        {toasts.map((t) => (
          <div key={t.id} className={`alert max-w-sm ${t.level === "success" ? "alert-success" : t.level === "error" ? "alert-error" : "alert-info"}`}>
            <span className="text-sm">{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function toPage(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const r = canvas.getBoundingClientRect();
  return {
    x: Math.round(((clientX - r.left) * canvas.width) / r.width),
    y: Math.round(((clientY - r.top) * canvas.height) / r.height),
  };
}

function Overlay({ rect, scale, className }: { rect: Rect; scale: number; className: string }) {
  return (
    <div
      className={`pointer-events-none absolute rounded-sm border-2 transition-all duration-75 ${className}`}
      style={{ left: rect.x * scale, top: rect.y * scale, width: rect.w * scale, height: rect.h * scale }}
    />
  );
}

function ModeButton({
  active, danger, onClick, icon, label,
}: { active: boolean; danger?: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button className={`btn join-item btn-sm ${active ? (danger ? "btn-error" : "btn-primary") : ""}`} onClick={onClick}>
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function TestResultBadge({ result }: { result: { count: number; error?: string } }) {
  if (result.error) return <div className="text-xs text-error">Selector lỗi: {result.error}</div>;
  return (
    <div className={`mt-1 text-xs ${result.count === 1 ? "text-success" : result.count === 0 ? "text-error" : "text-warning"}`}>
      {result.count === 0 ? "Không tìm thấy phần tử nào" : result.count === 1 ? "✓ Khớp đúng 1 phần tử" : `Khớp ${result.count} phần tử (bot sẽ dùng phần tử đầu tiên)`}
    </div>
  );
}
