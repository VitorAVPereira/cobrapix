"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FinancialActivationAdmin } from "@/components/features/financial-activation/FinancialActivationAdmin";
import { FinancialHistoryPanel } from "@/components/features/financial-activation/FinancialHistoryPanel";

export default function AdminFinancialActivationPage(): ReactNode {
  const { companyId } = useParams<{ companyId: string }>();
  return (
    <>
      <FinancialActivationAdmin companyId={companyId} />
      <div className="mx-auto max-w-4xl space-y-4 px-5 pb-8 sm:px-8">
        <Link
          href={`/admin/conciliacao?companyId=${encodeURIComponent(companyId)}`}
          className="inline-block text-sm font-semibold text-emerald-700 underline"
        >
          Ver conciliação deste cliente
        </Link>
        <FinancialHistoryPanel companyId={companyId} />
      </div>
    </>
  );
}
