import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PageSkeleton } from "@/components/page-skeleton";
import { LiveBrowser } from "./live-browser";

export default function LiveBrowserPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(["ADMIN", "OPERATOR"]);
  const { id } = await params;
  const a = await prisma.tradingAccount.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      platformName: true,
      loginMethod: true,
      viewportWidth: true,
      viewportHeight: true,
      usernameSelector: true,
      passwordSelector: true,
      submitSelector: true,
      successSelector: true,
      balanceSelector: true,
      storageStateEnc: true,
    },
  });
  if (!a) notFound();
  const { storageStateEnc, ...account } = a;

  return (
    <div className="space-y-4">
      <div>
        <div className="breadcrumbs text-sm">
          <ul>
            <li>
              <Link href="/accounts">Tài khoản sàn</Link>
            </li>
            <li>
              <Link href={`/accounts/${a.id}`}>{a.name}</Link>
            </li>
            <li>Trình duyệt trực tiếp</li>
          </ul>
        </div>
        <h1 className="text-2xl font-bold">Trình duyệt trực tiếp</h1>
        <p className="text-sm text-base-content/60">
          Thao tác trên website thật qua canvas. Dùng <b>Chọn phần tử</b> để lấy selector, <b>Ghi thao tác</b> để ghi lại các bước,
          và <b>Lưu phiên</b> sau khi đăng nhập.
        </p>
      </div>
      <LiveBrowser account={{ ...account, hasSession: !!storageStateEnc }} />
    </div>
  );
}
