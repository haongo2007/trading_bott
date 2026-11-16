"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";
import { decrypt, encrypt } from "@/lib/crypto";
import { accountSchema, type AccountFormState } from "@/lib/validation/account";
import { Prisma } from "@/generated/prisma/client";

const WRITE_ROLES = ["ADMIN", "OPERATOR"] as const;

function parse(formData: FormData) {
  return accountSchema.safeParse(Object.fromEntries(formData));
}

export async function createAccount(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const user = await requireUser([...WRITE_ROLES]);
  const parsed = parse(formData);
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  const { username, password, disabled, ...rest } = parsed.data;
  if (!password && rest.loginMethod !== "NONE") return { errors: { password: ["Bắt buộc"] } };

  const account = await prisma.tradingAccount.create({
    data: {
      ...rest,
      usernameEnc: encrypt(username),
      passwordEnc: encrypt(password ?? ""),
      status: disabled ? "DISABLED" : "UNVERIFIED",
    },
  });
  await prisma.auditLog.create({
    data: { userId: user.id, action: "CREATE", entity: "TradingAccount", entityId: account.id, diff: rest },
  });
  revalidatePath("/accounts");
  redirect("/accounts");
}

export async function updateAccount(
  id: string,
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const user = await requireUser([...WRITE_ROLES]);
  const parsed = parse(formData);
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };

  const current = await prisma.tradingAccount.findUnique({ where: { id } });
  if (!current) return { message: "Không tìm thấy tài khoản" };

  const { username, password, disabled, ...rest } = parsed.data;
  const usernameChanged = decrypt(current.usernameEnc) !== username;
  const credentialsChanged = usernameChanged || !!password || current.loginUrl !== rest.loginUrl;

  let status = current.status;
  if (disabled) status = "DISABLED";
  else if (current.status === "DISABLED" || credentialsChanged) status = "UNVERIFIED";

  await prisma.tradingAccount.update({
    where: { id },
    data: {
      ...rest,
      ...(usernameChanged && { usernameEnc: encrypt(username) }),
      ...(password && { passwordEnc: encrypt(password) }),
      // Đổi thông tin đăng nhập → phiên cũ không còn tin cậy
      ...(credentialsChanged && { storageStateEnc: null }),
      status,
    },
  });
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "UPDATE",
      entity: "TradingAccount",
      entityId: id,
      diff: { ...rest, usernameChanged, passwordChanged: !!password, status },
    },
  });
  revalidatePath("/accounts");
  redirect("/accounts");
}

export async function deleteAccount(id: string): Promise<AccountFormState> {
  const user = await requireUser(["ADMIN"]);
  try {
    await prisma.tradingAccount.delete({ where: { id } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      return { message: "Tài khoản đang được bot sử dụng, hãy xoá/đổi bot trước." };
    }
    throw e;
  }
  await prisma.auditLog.create({
    data: { userId: user.id, action: "DELETE", entity: "TradingAccount", entityId: id },
  });
  revalidatePath("/accounts");
  redirect("/accounts");
}
