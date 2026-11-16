import Link from "next/link";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { notFound } from "next/navigation";
import { MonitorPlay, TriangleAlert } from "lucide-react";
import { TestLoginButton } from "../test-login-button";
import { requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { accountStatusMeta } from "@/lib/validation/account";
import { AccountForm } from "../account-form";
import { updateAccount } from "../actions";
import { DeleteAccountModal } from "../delete-account-modal";

export default function EditAccountPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EditAccountContent params={params} />
    </Suspense>
  );
}

async function EditAccountContent({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["ADMIN", "OPERATOR"]);
  const { id } = await params;
  const a = await prisma.tradingAccount.findUnique({ where: { id } });
  if (!a) notFound();

  const initial = {
    name: a.name,
    platformName: a.platformName,
    loginUrl: a.loginUrl,
    tradeUrl: a.tradeUrl,
    username: decrypt(a.usernameEnc),
    loginMethod: a.loginMethod,
    usernameSelector: a.usernameSelector ?? "",
    passwordSelector: a.passwordSelector ?? "",
    submitSelector: a.submitSelector ?? "",
    successSelector: a.successSelector ?? "",
    balanceSelector: a.balanceSelector ?? "",
    currency: a.currency,
    viewportWidth: a.viewportWidth,
    viewportHeight: a.viewportHeight,
    locale: a.locale,
    timezone: a.timezone,
    loginTimeoutSec: a.loginTimeoutSec,
    maxLoginRetries: a.maxLoginRetries,
    notes: a.notes ?? "",
    disabled: a.status === "DISABLED",
  };
  const st = accountStatusMeta[a.status];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="breadcrumbs text-sm">
            <ul>
              <li>
                <Link href="/accounts">Tài khoản sàn</Link>
              </li>
              <li>{a.name}</li>
            </ul>
          </div>
          <h1 className="flex items-center gap-3 text-2xl font-bold">
            {a.name}
            <span className={`badge badge-soft ${st.badge}`}>{st.text}</span>
          </h1>
          <p className="text-sm text-base-content/60">{a.platformName}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <TestLoginButton accountId={id} disabled={a.status === "DISABLED"} />
          <Link href={`/accounts/${id}/browser`} className="btn btn-sm btn-primary">
            <MonitorPlay className="size-4" /> Trình duyệt trực tiếp
          </Link>
          {user.role === "ADMIN" && <DeleteAccountModal id={id} name={a.name} />}
        </div>
      </div>

      {a.lastError && (
        <div role="alert" className="alert alert-warning alert-soft">
          <TriangleAlert className="size-5" />
          <span>
            <b>Lỗi gần nhất:</b> {a.lastError}
          </span>
        </div>
      )}

      <AccountForm action={updateAccount.bind(null, id)} initial={initial} isEdit />
    </div>
  );
}
