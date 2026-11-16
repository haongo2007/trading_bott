import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { csvCell } from "@/lib/report";

// Xuất CSV các lệnh trong khoảng ngày (chỉ người đã đăng nhập).
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const sp = new URL(req.url).searchParams;
  const isDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const from = sp.get("from");
  const to = sp.get("to");
  if (!isDate(from) || !isDate(to)) return new Response("Thiếu from/to (YYYY-MM-DD)", { status: 400 });
  const mode = sp.get("mode");
  const bot = sp.get("bot");

  const orders = await prisma.order.findMany({
    where: {
      run: {
        runDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
        ...(mode === "real" && { dryRun: false }),
        ...(mode === "dry" && { dryRun: true }),
        ...(bot && { botId: bot }),
      },
    },
    orderBy: { placedAt: "asc" },
    take: 50_000,
    include: { run: { select: { runDate: true, dryRun: true, bot: { select: { name: true, account: { select: { name: true } } } } } }, prediction: true },
  });

  const header = ["thoi_gian", "ngay_giao_dich", "bot", "tai_khoan", "che_do", "lenh_so", "huong", "so_tien", "ket_qua", "lai_lo", "so_du_truoc", "so_du_sau", "ai_do_tin_cay", "loi"];
  const lines = orders.map((o) =>
    [
      o.placedAt.toISOString(),
      o.run.runDate.toISOString().slice(0, 10),
      o.run.bot.name,
      o.run.bot.account.name,
      o.run.dryRun ? "thu" : "that",
      o.seq,
      o.direction,
      Number(o.amount),
      o.result,
      o.pnl === null ? "" : Number(o.pnl),
      o.balanceBefore === null ? "" : Number(o.balanceBefore),
      o.balanceAfter === null ? "" : Number(o.balanceAfter),
      o.prediction ? o.prediction.confidence.toFixed(2) : "",
      o.error ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  // BOM để Excel đọc đúng tiếng Việt UTF-8
  const body = "﻿" + [header.join(","), ...lines].join("\r\n");
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="lenh_${from}_${to}.csv"`,
      "cache-control": "no-store",
    },
  });
}
