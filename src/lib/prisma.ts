import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@/generated/prisma/client";

// Dùng chung 1 instance trong dev (tránh tạo nhiều pool khi hot-reload).
// Lưu kèm class PrismaClient: sau `prisma generate` class đổi → tạo instance mới (không dùng client cũ thiếu enum/field mới).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; prismaCtor?: typeof PrismaClient };

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL chưa được cấu hình");
  const adapter = new PrismaMariaDb(url);
  return new PrismaClient({ adapter });
}

const cached = globalForPrisma.prismaCtor === PrismaClient ? globalForPrisma.prisma : undefined;
if (!cached && globalForPrisma.prisma) globalForPrisma.prisma.$disconnect().catch(() => {});

export const prisma = cached ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaCtor = PrismaClient;
}
