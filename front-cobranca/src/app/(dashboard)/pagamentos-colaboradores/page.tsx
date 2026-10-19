"use client";
import { useEffect, useState } from "react";
import { useApiClient } from "@/lib/use-api-client";
import type { DisbursementStatus } from "@/lib/api-client";
import { BatchesPanel } from "@/components/features/disbursements/BatchesPanel";
import { RecipientsPanel } from "@/components/features/disbursements/RecipientsPanel";

type Tab = "batches" | "recipients";

export default function CollaboratorPaymentsPage() {
  const api = useApiClient();
  const [status, setStatus] = useState<DisbursementStatus | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("batches");

  useEffect(() => {
    let current = true;
    api
      .getDisbursementStatus()
      .then((loaded) => {
        if (!current) return;
        // The first attempt may run before the session token exists; success clears it.
        setError("");
        setStatus(loaded);
      })
      .catch(() => {
        if (current)
          setError("Não foi possível carregar os pagamentos a colaboradores.");
      });
    return () => {
      current = false;
    };
  }, [api]);

  return (
    <main className="min-h-full bg-slate-50">
      <div className="mx-auto max-w-6xl space-y-5 p-4 lg:p-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Pagamentos a colaboradores
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Pix da conta Efí da empresa, enviados só depois da confirmação no
            WhatsApp
            {status?.approverName
              ? ` de ${status.approverName} (${status.approverPhoneMasked})`
              : " do responsável"}
            .
          </p>
        </div>
        {error ? (
          <p
            role="alert"
            className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
          >
            {error}
          </p>
        ) : !status ? (
          <p className="text-sm text-slate-500">Carregando…</p>
        ) : !status.enabled ? (
          <p className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-600">
            Pagamentos a colaboradores não estão liberados para a sua empresa.
            Fale com o suporte CifraMais para contratar.
          </p>
        ) : (
          <>
            <div
              role="tablist"
              className="flex gap-2 border-b border-slate-200"
            >
              {(
                [
                  ["batches", "Pagamentos"],
                  ["recipients", "Colaboradores"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  onClick={() => setTab(value)}
                  className={`-mb-px px-3 py-2 text-sm ${
                    tab === value
                      ? "border-b-2 border-emerald-600 font-semibold text-emerald-700"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === "batches" ? (
              <BatchesPanel status={status} />
            ) : (
              <RecipientsPanel />
            )}
          </>
        )}
      </div>
    </main>
  );
}
