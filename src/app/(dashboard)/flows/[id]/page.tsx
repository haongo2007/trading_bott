import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";
import { defaultGraph, flowGraphSchema, type FlowGraph } from "@/lib/flow";
import { PageSkeleton } from "@/components/page-skeleton";
import { FlowEditor } from "./flow-editor";

export default function FlowEditorPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [flow, accounts] = await Promise.all([
    prisma.flow.findUnique({ where: { id } }),
    prisma.tradingAccount.findMany({
      where: { status: { not: "DISABLED" } },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, platformName: true, status: true,
        loginMethod: true, viewportWidth: true, viewportHeight: true, storageStateEnc: true,
      },
    }),
  ]);
  if (!flow) notFound();
  const parsed = flowGraphSchema.safeParse(flow.graph);
  const graph: FlowGraph = parsed.success ? (parsed.data as FlowGraph) : defaultGraph();

  return (
    <div className="space-y-4">
      <div className="breadcrumbs text-sm">
        <ul>
          <li>
            <Link href="/flows">Flow</Link>
          </li>
          <li>{flow.name}</li>
        </ul>
      </div>
      <FlowEditor
        flow={{ id: flow.id, name: flow.name, version: flow.version, graph }}
        accounts={accounts.map(({ storageStateEnc, ...a }) => ({ ...a, hasSession: !!storageStateEnc }))}
        canWrite={user.role !== "VIEWER"}
        canDelete={user.role === "ADMIN"}
      />
    </div>
  );
}
