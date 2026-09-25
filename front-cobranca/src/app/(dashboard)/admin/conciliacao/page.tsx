"use client";
import { Suspense } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { SettlementsAdmin } from "@/components/features/settlements/SettlementsAdmin";

function Content(): ReactNode {
  // Optional filter by company, e.g. from the client list.
  const companyId = useSearchParams().get("companyId") ?? undefined;
  return <SettlementsAdmin companyId={companyId} />;
}

export default function AdminSettlementsPage(): ReactNode {
  return (
    <main className="min-h-full bg-slate-50 p-4 lg:p-8">
      <Suspense fallback={null}>
        <Content />
      </Suspense>
    </main>
  );
}
