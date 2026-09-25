import type { ReactNode } from "react";
import { CompanyFinancialView } from "@/components/features/settlements/CompanyFinancialView";

export default function FinancialPage(): ReactNode {
  return (
    <main className="min-h-full bg-slate-50 p-4 lg:p-8">
      <CompanyFinancialView />
    </main>
  );
}
