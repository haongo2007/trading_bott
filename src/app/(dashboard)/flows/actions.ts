"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";
import { defaultGraph, flowGraphSchema, stepsToGraph, validateFlow, type FlowRunResult } from "@/lib/flow";
import type { RecordedStep } from "@/lib/live-protocol";

const WRITE_ROLES = ["ADMIN", "OPERATOR"] as const;

export async function createFlow(formData: FormData) {
  const user = await requireUser([...WRITE_ROLES]);
  const name = String(formData.get("name") ?? "").trim().slice(0, 100) || "Flow mới";
  const flow = await prisma.flow.create({ data: { name, graph: defaultGraph(), elements: {} } });
  await prisma.auditLog.create({ data: { userId: user.id, action: "CREATE", entity: "Flow", entityId: flow.id } });
  redirect(`/flows/${flow.id}`);
}

export async function createFlowFromSteps(accountId: string, steps: RecordedStep[], startUrl?: string): Promise<{ id: string }> {
  const user = await requireUser([...WRITE_ROLES]);
  const account = await prisma.tradingAccount.findUnique({ where: { id: accountId }, select: { name: true } });
  if (!account) throw new Error("Không tìm thấy tài khoản");
  const graph = stepsToGraph(steps.slice(0, 150), startUrl && /^https?:\/\//.test(startUrl) ? startUrl : undefined);
  const flow = await prisma.flow.create({
    data: {
      name: `Flow ghi từ ${account.name} — ${new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}`,
      startUrl: startUrl ?? null,
      graph,
      elements: {},
    },
  });
  await prisma.auditLog.create({ data: { userId: user.id, action: "CREATE_FROM_RECORDING", entity: "Flow", entityId: flow.id } });
  revalidatePath("/flows");
  return { id: flow.id };
}

export type SaveFlowResult = { ok: boolean; version?: number; error?: string; warnings?: string[] };

export async function saveFlow(id: string, name: string, graph: unknown): Promise<SaveFlowResult> {
  const user = await requireUser([...WRITE_ROLES]);
  const parsed = flowGraphSchema.safeParse(graph);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `Dữ liệu không hợp lệ (${issue.path.join(".")}: ${issue.message})` };
  }
  const trimmed = name.trim().slice(0, 100);
  if (!trimmed) return { ok: false, error: "Tên flow không được để trống" };

  const flow = await prisma.flow.update({
    where: { id },
    data: { name: trimmed, graph: parsed.data, version: { increment: 1 } },
  });
  await prisma.auditLog.create({
    data: { userId: user.id, action: "UPDATE", entity: "Flow", entityId: id, diff: { version: flow.version, nodes: parsed.data.nodes.length } },
  });
  revalidatePath("/flows");
  return { ok: true, version: flow.version, warnings: validateFlow(parsed.data).map((e) => e.message) };
}

export async function deleteFlow(id: string) {
  const user = await requireUser(["ADMIN"]);
  const inUse = await prisma.bot.count({ where: { flowId: id } });
  if (inUse) return { ok: false, error: `Flow đang được ${inUse} bot sử dụng` };
  await prisma.flow.delete({ where: { id } });
  await prisma.auditLog.create({ data: { userId: user.id, action: "DELETE", entity: "Flow", entityId: id } });
  revalidatePath("/flows");
  redirect("/flows");
}

const runSchema = z.object({ flowId: z.string().min(1), accountId: z.string().min(1), dryRun: z.boolean(), loginFirst: z.boolean() });

export async function startFlowRun(input: z.infer<typeof runSchema>): Promise<{ commandId?: string; error?: string }> {
  const user = await requireUser([...WRITE_ROLES]);
  const { flowId, accountId, dryRun, loginFirst } = runSchema.parse(input);
  const [flow, account] = await Promise.all([
    prisma.flow.findUnique({ where: { id: flowId }, select: { graph: true } }),
    prisma.tradingAccount.findUnique({ where: { id: accountId }, select: { status: true } }),
  ]);
  if (!flow) return { error: "Không tìm thấy flow" };
  if (!account) return { error: "Không tìm thấy tài khoản" };
  if (account.status === "DISABLED") return { error: "Tài khoản đang tạm khoá" };
  const problems = validateFlow(flow.graph as never);
  if (problems.length) return { error: `Flow chưa hợp lệ: ${problems[0].message}` };

  const busy = await prisma.command.findFirst({ where: { accountId, status: { in: ["PENDING", "PROCESSING"] } } });
  if (busy) return { error: "Tài khoản đang có lệnh khác chạy" };

  const cmd = await prisma.command.create({ data: { type: "RUN_FLOW", accountId, payload: { flowId, dryRun, loginFirst } } });
  await prisma.auditLog.create({
    data: { userId: user.id, action: dryRun ? "RUN_FLOW_DRY" : "RUN_FLOW_LIVE", entity: "Flow", entityId: flowId, diff: { accountId, commandId: cmd.id } },
  });
  return { commandId: cmd.id };
}

export async function cancelFlowRun(commandId: string) {
  await requireUser([...WRITE_ROLES]);
  await prisma.command.updateMany({
    where: { id: commandId, status: { in: ["PENDING", "PROCESSING"] } },
    data: { status: "CANCELLED" },
  });
}

export type FlowRunView = {
  status: "PENDING" | "PROCESSING" | "DONE" | "FAILED" | "CANCELLED";
  ageSec: number;
  result: (FlowRunResult & { cancelled?: boolean }) | null;
};

export async function getFlowRun(commandId: string): Promise<FlowRunView | null> {
  await requireUser();
  const cmd = await prisma.command.findUnique({ where: { id: commandId } });
  if (!cmd || cmd.type !== "RUN_FLOW") return null;
  let result: FlowRunView["result"] = null;
  try {
    result = cmd.result ? JSON.parse(cmd.result) : null;
  } catch {
    result = null;
  }
  return { status: cmd.status, ageSec: Math.round((Date.now() - cmd.createdAt.getTime()) / 1000), result };
}
