"use client";
import type { ReactNode } from "react";
import { useParams } from "next/navigation";
import { FinancialActivationAdmin } from "@/components/features/financial-activation/FinancialActivationAdmin";

export default function AdminFinancialActivationPage(): ReactNode {
  const { companyId } = useParams<{ companyId: string }>();
  return <FinancialActivationAdmin companyId={companyId} />;
}
