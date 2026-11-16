import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { AiConfig, Dir, OrderOutcome } from "@/lib/strategy";
import { marketOutcome } from "@/lib/strategy";

export const DEFAULT_AI_MODEL = "claude-opus-5-5";

// Ràng buộc min/max của số được kiểm tra sau khi parse (structured outputs không áp dụng mọi từ khoá JSON Schema)
const PredictionSchema = z.object({
  direction: z.enum(["UP", "DOWN"]),
  confidence: z.number().describe("Độ tin cậy từ 0 đến 1"),
  reasoning: z.string().describe("Giải thích ngắn gọn bằng tiếng Việt (tối đa 2 câu)"),
});

const SYSTEM = `Bạn hỗ trợ một bot giao dịch dạng lên/xuống (UP/DOWN) theo từng phiên ngắn.
Nhiệm vụ: dựa trên lịch sử các phiên gần nhất, chọn hướng cho phiên tiếp theo và ước lượng độ tin cậy.

Nguyên tắc bắt buộc:
- Kết quả các phiên ngắn hạn gần như ngẫu nhiên. Chỉ đưa độ tin cậy cao khi dữ liệu cho thấy một quy luật rõ ràng, nhất quán.
- Nếu không thấy lợi thế thực sự, vẫn chọn một hướng nhưng đặt confidence trong khoảng 0.50–0.55. Bot sẽ bỏ qua phiên khi độ tin cậy thấp — đó là hành vi mong muốn, không phải thất bại.
- Không bịa dữ liệu không có trong đầu vào.`;

let client: Anthropic | null = null;
function getClient() {
  // Tự đọc thông tin xác thực từ môi trường (ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN hoặc profile `ant auth login`)
  client ??= new Anthropic({ timeout: 90_000, maxRetries: 1 });
  return client;
}

export type AiPredictionResult = {
  direction: Dir;
  confidence: number;
  reasoning: string;
  model: string;
  latencyMs: number;
};

export async function predictDirection(
  cfg: AiConfig,
  history: OrderOutcome[],
  extra: { vars?: Record<string, string | number>; balance?: number },
): Promise<AiPredictionResult> {
  const model = cfg.model || DEFAULT_AI_MODEL;
  const recent = history.slice(-(cfg.history ?? 20));
  const lines = recent.map((o, i) => {
    const market = marketOutcome(o);
    return `${i + 1}. đặt ${o.direction} ${o.amount} → ${o.result}${market ? ` (thị trường: ${market})` : ""}`;
  });
  const varsText = extra.vars && Object.keys(extra.vars).length
    ? Object.entries(extra.vars).map(([k, v]) => `- ${k}: ${String(v).slice(0, 500)}`).join("\n")
    : "(không có)";

  const userText = [
    `Lịch sử ${recent.length} lệnh gần nhất của bot (cũ → mới):`,
    lines.length ? lines.join("\n") : "(chưa có lệnh nào hôm nay)",
    "",
    "Dữ liệu đọc từ trang sàn ở lượt trước (nếu flow có khối Đọc giá trị):",
    varsText,
    cfg.extraPrompt?.trim() ? `\nGhi chú của người vận hành:\n${cfg.extraPrompt.trim().slice(0, 2000)}` : "",
    "\nHãy chọn hướng cho phiên tiếp theo.",
  ].join("\n");

  // Haiku không hỗ trợ server-side fallback; các model khác bật fallback mặc định khi bị từ chối vì chính sách
  const withFallback = !model.includes("haiku");
  const t0 = Date.now();
  const res = await getClient().beta.messages.parse({
    model,
    max_tokens: 8000,
    ...(withFallback && { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
    output_config: { effort: cfg.effort ?? "low", format: betaZodOutputFormat(PredictionSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: userText }],
  });

  if (res.stop_reason === "refusal") throw new Error("AI từ chối trả lời yêu cầu này");
  const p = res.parsed_output;
  if (!p) throw new Error(`AI không trả về kết quả hợp lệ (stop_reason: ${res.stop_reason})`);

  return {
    direction: p.direction,
    confidence: Math.min(1, Math.max(0, p.confidence)),
    reasoning: p.reasoning.slice(0, 1000),
    model: res.model ?? model,
    latencyMs: Date.now() - t0,
  };
}

/** Thông báo lỗi dễ hiểu cho các lỗi API thường gặp. */
export function describeAiError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "Chưa cấu hình hoặc sai ANTHROPIC_API_KEY cho worker";
  if (e instanceof Anthropic.RateLimitError) return "AI bị giới hạn tốc độ (rate limit) — thử lại sau";
  if (e instanceof Anthropic.BadRequestError) return `Yêu cầu AI không hợp lệ: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return "Không kết nối được tới API của Claude";
  if (e instanceof Anthropic.APIError) return `Lỗi API AI (${e.status}): ${e.message}`;
  const msg = (e as Error).message ?? String(e);
  // SDK báo lỗi phía client (không phải lỗi API) khi không tìm thấy thông tin xác thực nào
  if (/Could not resolve authentication method/i.test(msg)) {
    return "Worker chưa có thông tin xác thực Claude — đặt ANTHROPIC_API_KEY trong .env rồi khởi động lại worker";
  }
  return msg;
}
