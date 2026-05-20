import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  if (!req.auth) {
    const isApiRoute = req.nextUrl.pathname.startsWith("/api/");
    if (isApiRoute) {
      return NextResponse.json(
        { error: "Nao autorizado." },
        { status: 401 }
      );
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const role = req.auth.user?.role;
  if (
    req.nextUrl.pathname.startsWith("/admin") &&
    role !== "PLATFORM_ADMIN"
  ) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (
    role !== "PLATFORM_ADMIN" &&
    (req.nextUrl.pathname.startsWith("/configuracoes/whatsapp") ||
      req.nextUrl.pathname.startsWith("/configuracoes/conecte-seu-banco"))
  ) {
    return NextResponse.redirect(new URL("/configuracoes/cobranca", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!login|api/auth|api/webhooks|_next/static|_next/image|favicon.ico).*)",
  ],
};
