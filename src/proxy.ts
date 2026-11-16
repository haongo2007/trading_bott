import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Kiểm tra lạc quan: chưa đăng nhập → về /login. Quyền chi tiết vẫn kiểm tra trong server action / page.
export default auth((req) => {
  const isLoggedIn = !!req.auth?.user;
  const { pathname } = req.nextUrl;
  const isPublic = pathname.startsWith("/login");

  if (!isLoggedIn && !isPublic) {
    const url = new URL("/login", req.nextUrl);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }
  if (isLoggedIn && isPublic) return NextResponse.redirect(new URL("/", req.nextUrl));
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
