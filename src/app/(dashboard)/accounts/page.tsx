import Link from "next/link";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { CircleCheck, CircleX, KeyRound, Lock, MonitorPlay, Pencil, Plus, Users } from "lucide-react";
import { requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";
import { accountStatusMeta } from "@/lib/validation/account";

const dateFmt = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Asia/Ho_Chi_Minh",
});

// Phần đọc session/DB nằm trong <Suspense> của chính page → điều hướng client hiển thị skeleton ngay
export default function AccountsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AccountsContent />
    </Suspense>
  );
}

async function AccountsContent() {
  const user = await requireUser();
  const accounts = await prisma.tradingAccount.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      platformName: true,
      loginMethod: true,
      status: true,
      lastLoginAt: true,
      lastBalance: true,
      currency: true,
      _count: { select: { bots: true } },
    },
  });
  const canWrite = user.role !== "VIEWER";
  const count = (s: keyof typeof accountStatusMeta) => accounts.filter((a) => a.status === s).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Tài khoản sàn</h1>
          <p className="text-sm text-base-content/60">Thông tin truy cập nền tảng mà bot dùng để đăng nhập và đặt lệnh.</p>
        </div>
        {canWrite && (
          <Link href="/accounts/new" className="btn btn-primary">
            <Plus className="size-4" /> Thêm tài khoản
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<Users className="size-6" />} title="Tổng tài khoản" value={accounts.length} />
        <Stat icon={<CircleCheck className="size-6 text-success" />} title="Hoạt động" value={count("ACTIVE")} />
        <Stat icon={<CircleX className="size-6 text-error" />} title="Lỗi đăng nhập" value={count("LOGIN_FAILED")} />
        <Stat icon={<Lock className="size-6 text-warning" />} title="Tạm khoá" value={count("DISABLED")} />
      </div>

      <div className="card bg-base-100 shadow-sm">
        {accounts.length === 0 ? (
          <div className="card-body items-center py-16 text-center">
            <div className="grid size-16 place-items-center rounded-full bg-base-200">
              <KeyRound className="size-7 text-base-content/50" />
            </div>
            <h2 className="mt-2 text-lg font-semibold">Chưa có tài khoản nào</h2>
            <p className="max-w-sm text-sm text-base-content/60">
              Thêm tài khoản sàn đầu tiên để bot có thể đăng nhập và thực hiện flow giao dịch.
            </p>
            {canWrite && (
              <Link href="/accounts/new" className="btn btn-primary btn-sm mt-2">
                <Plus className="size-4" /> Thêm tài khoản
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Tài khoản</th>
                  <th>Đăng nhập</th>
                  <th>Trạng thái</th>
                  <th className="text-right">Số dư gần nhất</th>
                  <th className="text-center">Bot</th>
                  <th>Lần đăng nhập cuối</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const st = accountStatusMeta[a.status];
                  return (
                    <tr key={a.id} className="hover:bg-base-200/50">
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="avatar avatar-placeholder">
                            <div className="w-9 rounded-field bg-primary/10 text-primary">
                              <span className="text-sm font-semibold uppercase">{initials(a.name)}</span>
                            </div>
                          </div>
                          <div className="whitespace-nowrap">
                            <div className="font-semibold">{a.name}</div>
                            <div className="text-xs text-base-content/60">{a.platformName}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="badge badge-ghost badge-sm">
                          {a.loginMethod === "FORM" ? "Tự điền form" : a.loginMethod === "NONE" ? "Không cần đăng nhập" : "Phiên đã lưu"}
                        </span>
                      </td>
                      <td>
                        <span className={`badge badge-soft badge-sm ${st.badge}`}>{st.text}</span>
                      </td>
                      <td className="text-right font-mono">
                        {a.lastBalance != null ? (
                          <>
                            {Number(a.lastBalance).toLocaleString("vi-VN")}{" "}
                            <span className="text-xs text-base-content/60">{a.currency}</span>
                          </>
                        ) : (
                          <span className="text-base-content/40">—</span>
                        )}
                      </td>
                      <td className="text-center">{a._count.bots}</td>
                      <td className="text-sm text-base-content/70">
                        {a.lastLoginAt ? dateFmt.format(a.lastLoginAt) : "—"}
                      </td>
                      <td className="text-right">
                        {canWrite && (
                          <div className="flex justify-end gap-1">
                            <div className="tooltip" data-tip="Trình duyệt trực tiếp">
                              <Link href={`/accounts/${a.id}/browser`} className="btn btn-ghost btn-sm btn-square" aria-label="Trình duyệt trực tiếp">
                                <MonitorPlay className="size-4" />
                              </Link>
                            </div>
                            <Link href={`/accounts/${a.id}`} className="btn btn-ghost btn-sm">
                              <Pencil className="size-4" /> Sửa
                            </Link>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// "Tài khoản chính" → "TC"
function initials(name: string) {
  const words = name.trim().split(/\s+/);
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
}

function Stat({ icon, title, value }: { icon: React.ReactNode; title: string; value: number }) {
  return (
    <div className="stats bg-base-100 shadow-sm">
      <div className="stat px-4 py-3 sm:px-6 sm:py-4">
        <div className="stat-figure">{icon}</div>
        <div className="stat-title text-xs sm:text-sm">{title}</div>
        <div className="stat-value text-2xl">{value}</div>
      </div>
    </div>
  );
}
