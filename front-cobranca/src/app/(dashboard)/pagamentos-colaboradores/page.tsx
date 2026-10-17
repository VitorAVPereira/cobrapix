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
        if (current) setStatus(loaded);
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Pagamentos a colaboradores
        </h1>
        <p className="text-sm text-slate-600">
          Pix da conta Efí da empresa para os colaboradores, enviados só depois
          da aprovação no WhatsApp
          {status?.approverName
            ? ` de ${status.approverName} (${status.approverPhoneMasked})`
            : ""}
          .
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      ) : !status ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : !status.enabled ? (
        <p className="rounded-lg bg-slate-50 p-4 text-sm">
          Pagamentos a colaboradores não estão liberados para a sua empresa.
          Fale com o suporte CifraMais para contratar.
        </p>
      ) : (
        <>
          <div role="tablist" className="flex gap-2 border-b">
            {(
              [
                ["batches", "Lotes"],
                ["recipients", "Colaboradores"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={`px-3 py-2 text-sm ${
                  tab === value
                    ? "border-b-2 border-indigo-600 font-semibold text-indigo-700"
                    : "text-slate-600"
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
  );
}
