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
  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!login|api/auth|api/webhooks|_next/static|_next/image|favicon.ico).*)",
  ],
};
