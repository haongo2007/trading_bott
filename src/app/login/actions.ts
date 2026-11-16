"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export async function login(_prev: string | undefined, formData: FormData) {
  const raw = String(formData.get("callbackUrl") || "/overview");
  // Chỉ cho phép redirect nội bộ
  const redirectTo = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/overview";
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo,
    });
  } catch (e) {
    if (e instanceof AuthError) return "Email hoặc mật khẩu không đúng";
    throw e; // redirect của Next.js
  }
}
