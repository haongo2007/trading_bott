import { Suspense } from "react";
import { Bot, LogOut, Menu } from "lucide-react";
import { auth, signOut } from "@/auth";
import { NavMenu, NavMenuList } from "@/components/nav-menu";
import { PageSkeleton } from "@/components/page-skeleton";
import { KillSwitch } from "@/components/kill-switch";

// Khung tĩnh (sidebar) prerender sẵn; phần đọc session/DB stream vào trong <Suspense>.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="drawer lg:drawer-open">
      <input id="app-drawer" type="checkbox" className="drawer-toggle" />

      <div className="drawer-content flex min-h-screen flex-col">
        <header className="navbar sticky top-0 z-30 border-b border-base-300 bg-base-100 lg:hidden">
          <label htmlFor="app-drawer" className="btn btn-square btn-ghost" aria-label="Mở menu">
            <Menu className="size-5" />
          </label>
          <Brand />
        </header>
        <main className="flex-1 p-4 lg:p-8">
          <div className="mx-auto max-w-6xl">
            <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
          </div>
        </main>
      </div>

      <div className="drawer-side z-40">
        <label htmlFor="app-drawer" aria-label="Đóng menu" className="drawer-overlay" />
        <aside className="flex min-h-full w-64 flex-col border-r border-base-300 bg-base-100">
          <div className="p-4">
            <Brand />
          </div>
          <Suspense fallback={<NavMenuList pathname={null} />}>
            <NavMenu />
          </Suspense>
          <div className="mt-auto space-y-3 border-t border-base-300 p-3">
            <KillSwitch />
            <Suspense fallback={<div className="skeleton h-12 w-full" />}>
              <UserBox />
            </Suspense>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-9 place-items-center rounded-field bg-primary text-primary-content">
        <Bot className="size-5" />
      </div>
      <div className="leading-tight">
        <div className="font-bold">Bot Trading</div>
        <div className="text-xs text-base-content/60">Auto trading console</div>
      </div>
    </div>
  );
}

async function UserBox() {
  const session = await auth();
  if (!session?.user) return null;
  const email = session.user.email ?? "";
  return (
    <div className="flex items-center gap-3">
      <div className="avatar avatar-placeholder">
        <div className="w-9 rounded-full bg-neutral text-neutral-content">
          <span className="text-sm uppercase">{email.charAt(0)}</span>
        </div>
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-sm font-medium">{email}</div>
        <span className="badge badge-ghost badge-xs">{session.user.role}</span>
      </div>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <div className="tooltip tooltip-top" data-tip="Đăng xuất">
          <button className="btn btn-ghost btn-sm btn-square" aria-label="Đăng xuất">
            <LogOut className="size-4" />
          </button>
        </div>
      </form>
    </div>
  );
}

