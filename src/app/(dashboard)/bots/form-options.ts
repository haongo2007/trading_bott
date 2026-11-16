import { prisma } from "@/lib/prisma";

/** Danh sách tài khoản & flow cho form bot, kèm cảnh báo cấu hình còn thiếu. */
export async function loadBotFormOptions() {
  const [accounts, flows] = await Promise.all([
    prisma.tradingAccount.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, platformName: true, status: true, balanceSelector: true },
    }),
    prisma.flow.findMany({ orderBy: { updatedAt: "desc" }, select: { id: true, name: true, graph: true } }),
  ]);
  return {
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      note: a.platformName + (a.status === "DISABLED" ? " (tạm khoá)" : a.status === "LOGIN_FAILED" ? " (lỗi đăng nhập)" : ""),
      warn: !a.balanceSelector ? "Tài khoản chưa có selector số dư — bot không thể quản lý rủi ro." : undefined,
    })),
    flows: flows.map((f) => {
      const hasOrder = ((f.graph as { nodes?: { type: string }[] }).nodes ?? []).some((n) => n.type === "order");
      return {
        id: f.id,
        name: f.name,
        note: hasOrder ? undefined : "chưa có khối Đặt lệnh",
        warn: hasOrder ? undefined : "Flow này chưa có khối “Đặt lệnh” — mở flow và thêm khối trước khi dùng cho bot.",
      };
    }),
  };
}
