import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

const PLATFORM_ADMIN_ALLOWED_PATHS = [
  "/admin/clientes",
  "/admin/visao-geral",
] as const;

function isAllowedPlatformAdminPath(pathname: string): boolean {
  return PLATFORM_ADMIN_ALLOWED_PATHS.some(
    (allowedPath) =>
      pathname === allowedPath || pathname.startsWith(`${allowedPath}/`),
  );
}

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
  if (req.auth.user?.authInvalidated) {
    return NextResponse.redirect(new URL("/login?sessionExpired=1", req.url));
  }
  const isPlatformAdmin = role === "PLATFORM_ADMIN";
  const mustChangePassword = req.auth.user?.mustChangePassword ?? false;
  const isFirstAccessPath = pathname === "/primeiro-acesso";

  if (mustChangePassword && !isFirstAccessPath && !isApiRoute) {
    return NextResponse.redirect(new URL("/primeiro-acesso", req.url));
  }

  if (!mustChangePassword && isFirstAccessPath) {
    const destination = isPlatformAdmin ? "/admin/clientes" : "/cobrancas";
    return NextResponse.redirect(new URL(destination, req.url));
  }

  if (
    !isApiRoute &&
    isPlatformAdmin &&
    !isAllowedPlatformAdminPath(pathname)
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
    "/((?!login|esqueci-senha|redefinir-senha|api/auth|api/webhooks|_next/static|_next/image|favicon.ico).*)",
  ],
};
