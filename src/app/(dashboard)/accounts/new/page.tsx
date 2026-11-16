import Link from "next/link";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { requireUser } from "@/auth";
import { AccountForm, emptyAccount } from "../account-form";
import { createAccount } from "../actions";

export default function NewAccountPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewAccountContent />
    </Suspense>
  );
}

async function NewAccountContent() {
  await requireUser(["ADMIN", "OPERATOR"]);
  return (
    <div className="space-y-6">
      <div>
        <div className="breadcrumbs text-sm">
          <ul>
            <li>
              <Link href="/accounts">Tài khoản sàn</Link>
            </li>
            <li>Thêm mới</li>
          </ul>
        </div>
        <h1 className="text-2xl font-bold">Thêm tài khoản sàn</h1>
      </div>
      <AccountForm action={createAccount} initial={emptyAccount} />
    </div>
  );
}
