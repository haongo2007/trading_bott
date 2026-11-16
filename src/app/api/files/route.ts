import { readFile } from "node:fs/promises";
import path from "node:path";
import { auth } from "@/auth";

// Phục vụ ảnh chụp do worker lưu trong STORAGE_DIR (chỉ cho người đã đăng nhập).
const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const rel = new URL(req.url).searchParams.get("path") ?? "";
  const root = path.resolve(process.env.STORAGE_DIR ?? "storage");
  const target = path.resolve(root, rel);
  const type = TYPES[path.extname(target).toLowerCase()];
  // Chặn path traversal & loại file khác ảnh
  if (!rel || !type || !target.startsWith(root + path.sep)) return new Response("Not found", { status: 404 });

  try {
    const data = await readFile(target);
    return new Response(new Uint8Array(data), {
      headers: { "content-type": type, "cache-control": "private, max-age=3600" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
