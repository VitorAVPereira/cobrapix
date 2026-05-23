import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const pathname = req.nextUrl.pathname;
  const isApiRoute = pathname.startsWith("/api/");

  if (!req.auth) {
    if (isApiRoute) {
      return NextResponse.json(
        { error: "Nao autorizado." },
        { status: 401 }
      );
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const role = req.auth.user?.role;
  const isPlatformAdmin = role === "PLATFORM_ADMIN";

  if (
    !isApiRoute &&
    isPlatformAdmin &&
    pathname !== "/admin/clientes" &&
    !pathname.startsWith("/admin/clientes/")
  ) {
    return NextResponse.redirect(new URL("/admin/clientes", req.url));
  }

  if (
    pathname.startsWith("/admin") &&
    !isPlatformAdmin
  ) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (
    !isPlatformAdmin &&
    (pathname.startsWith("/configuracoes/whatsapp") ||
      pathname.startsWith("/configuracoes/conecte-seu-banco"))
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
