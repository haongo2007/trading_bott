"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, ChartLine, Gauge, KeyRound, LayoutDashboard, Settings, Workflow, type LucideIcon } from "lucide-react";

const items: { href: string; label: string; icon: LucideIcon; soon?: boolean }[] = [
  { href: "/overview", label: "Tổng quan", icon: Gauge },
  { href: "/accounts", label: "Tài khoản sàn", icon: KeyRound },
  { href: "/bots", label: "Bot", icon: Bot },
  { href: "/flows", label: "Flow", icon: Workflow },
  { href: "/history", label: "Lịch sử & báo cáo", icon: ChartLine },
  { href: "/settings", label: "Cài đặt", icon: Settings },
];

export function NavMenu() {
  return <NavMenuList pathname={usePathname()} />;
}

// pathname = null: dùng làm fallback tĩnh trong <Suspense> (chưa highlight mục đang chọn)
export function NavMenuList({ pathname }: { pathname: string | null }) {
  // Đóng drawer trên mobile sau khi chọn menu
  const closeDrawer = () => {
    const el = document.getElementById("app-drawer") as HTMLInputElement | null;
    if (el) el.checked = false;
  };

  return (
    <ul className="menu w-full gap-1 px-3">
      <li className="menu-title flex-row items-center gap-2">
        <LayoutDashboard className="size-3.5" /> Quản lý
      </li>
      {items.map(({ href, label, icon: Icon, soon }) => {
        const active = !!pathname && (pathname === href || pathname.startsWith(`${href}/`));
        if (soon) {
          return (
            <li key={href} className="menu-disabled">
              <span>
                <Icon className="size-4" />
                {label}
                <span className="badge badge-ghost badge-xs ml-auto">Sắp có</span>
              </span>
            </li>
          );
        }
        return (
          <li key={href}>
            <Link href={href} onClick={closeDrawer} className={active ? "menu-active bg-primary! text-primary-content!" : undefined}>
              <Icon className="size-4" />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
