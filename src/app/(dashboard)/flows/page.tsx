import Link from "next/link";
import { Suspense } from "react";
import { Pencil, Workflow } from "lucide-react";
import { requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { FlowGraph } from "@/lib/flow";
import { PageSkeleton } from "@/components/page-skeleton";
import { NewFlowButton } from "./new-flow-button";

const dateFmt = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });

export default function FlowsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <FlowsContent />
    </Suspense>
  );
}

async function FlowsContent() {
  const user = await requireUser();
  const canWrite = user.role !== "VIEWER";
  const flows = await prisma.flow.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, version: true, graph: true, updatedAt: true, _count: { select: { bots: true } } },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Flow</h1>
          <p className="text-sm text-base-content/60">Kịch bản thao tác trên website: đăng nhập, đọc số dư, nhập tiền, bấm đặt lệnh…</p>
        </div>
        {canWrite && <NewFlowButton />}
      </div>

      <div className="card bg-base-100 shadow-sm">
        {flows.length === 0 ? (
          <div className="card-body items-center py-16 text-center">
            <div className="grid size-16 place-items-center rounded-full bg-base-200">
              <Workflow className="size-7 text-base-content/50" />
            </div>
            <h2 className="mt-2 text-lg font-semibold">Chưa có flow nào</h2>
            <p className="max-w-md text-sm text-base-content/60">
              Tạo flow trống, hoặc vào <b>Tài khoản sàn → Trình duyệt trực tiếp</b>, bật <b>Ghi thao tác</b> rồi bấm <b>Tạo Flow</b> từ các bước đã ghi.
            </p>
            {canWrite && <NewFlowButton small />}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Tên flow</th>
                  <th className="text-center">Số khối</th>
                  <th className="text-center">Phiên bản</th>
                  <th className="text-center">Bot dùng</th>
                  <th>Cập nhật</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {flows.map((f) => (
                  <tr key={f.id} className="hover:bg-base-200/50">
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="grid size-9 place-items-center rounded-field bg-secondary/10 text-secondary">
                          <Workflow className="size-4" />
                        </div>
                        <Link href={`/flows/${f.id}`} className="font-semibold hover:underline">
                          {f.name}
                        </Link>
                      </div>
                    </td>
                    <td className="text-center">{(f.graph as FlowGraph).nodes?.length ?? 0}</td>
                    <td className="text-center">
                      <span className="badge badge-ghost badge-sm">v{f.version}</span>
                    </td>
                    <td className="text-center">{f._count.bots}</td>
                    <td className="text-sm text-base-content/70">{dateFmt.format(f.updatedAt)}</td>
                    <td className="text-right">
                      <Link href={`/flows/${f.id}`} className="btn btn-ghost btn-sm">
                        <Pencil className="size-4" /> {canWrite ? "Soạn" : "Xem"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
