import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";

// Tạo tài khoản admin đầu tiên từ biến môi trường
async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Cần ADMIN_EMAIL và ADMIN_PASSWORD trong .env");
  if (password.length < 12) throw new Error("ADMIN_PASSWORD tối thiểu 12 ký tự");

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, passwordHash, role: "ADMIN", name: "Admin" },
  });
  console.log(`Admin sẵn sàng: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
