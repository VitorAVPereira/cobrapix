"use client";

import { SessionProvider } from "next-auth/react";
import { usePathname } from "next/navigation";
import { isPublicPaymentPath } from "@/lib/public-routes";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // The public payment page neither needs nor queries the dashboard session.
  if (isPublicPaymentPath(usePathname())) return <>{children}</>;
  return <SessionProvider>{children}</SessionProvider>;
}
