"use client";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useApiClient } from "@/lib/use-api-client";
import type { CompanyFinancialProfile } from "@/lib/financial-activation";
import { formatCents } from "@/lib/settlements";
import type { CompanyReceipt, CompanyReceipts } from "@/lib/settlements";

const SITUATION_LABELS: Record<CompanyReceipt["situation"], string> = {
  RECEIVED: "Recebido",
  IN_REVIEW: "Em análise pela CifraMais",
  REFUNDED: "Devolvido",
  PARTIALLY_REFUNDED: "Devolvido parcialmente",
};

const MODE_LABELS: Record<string, string> = {
  CUSTOMER_ACCOUNT: "Conta Efí da própria empresa",
  PLATFORM_ACCOUNT: "Conta CifraMais",
};

function day(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("pt-BR") : "—";
}

// What the company sees about its own money. Read-only: account,
// credentials, fees and reconciliation are managed by CifraMais.
export function CompanyFinancialView(): ReactNode {
  const api = useApiClient();
  const [profile, setProfile] = useState<CompanyFinancialProfile | null>(null);
  const [receipts, setReceipts] = useState<CompanyReceipts | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([api.getFinancialProfile(), api.getCompanyReceipts(page, 20)])
      .then(([nextProfile, nextReceipts]) => {
        if (!active) return;
        setError(null);
        setProfile(nextProfile);
        setReceipts(nextReceipts);
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "Não foi possível carregar o financeiro.",
          );
      });
    return () => {
      active = false;
    };
  }, [api, page]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Financeiro</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Recebimentos das cobranças pagas, com tarifa Efí e remuneração
          CifraMais. A conta de recebimento, as credenciais e as tarifas são
          gerenciadas pela equipe CifraMais.
        </p>
      </header>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
        >
          {error}
        </p>
      )}

      {profile && (
        <section
          aria-label="Conta de recebimento"
          className="rounded-xl border border-slate-200 bg-white p-5 text-sm"
        >
          <h2 className="font-semibold text-slate-900">Conta de recebimento</h2>
          {profile.status === "ACTIVE" ? (
            <p className="mt-2 text-slate-700">
              {MODE_LABELS[profile.accountMode ?? ""] ?? profile.accountMode} ·
              conta {profile.issuerAccount ?? "—"} · meios{" "}
              {profile.enabledMethods.join(", ")} · ativa desde{" "}
              {day(profile.activatedAt)}. Os pagamentos caem diretamente nesta
              conta.
            </p>
          ) : (
            <p className="mt-2 text-amber-800">
              Ativação financeira pendente: a equipe CifraMais está configurando
              sua conta de recebimento.
            </p>
          )}
        </section>
      )}

      {receipts && (
        <>
          <section
            aria-label="Totais"
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
          >
            {[
              ["Recebido", receipts.totals.receivedCents],
              ["Tarifa Efí", receipts.totals.efiFeeCents],
              [
                "Remuneração CifraMais",
                receipts.totals.platformFeeCents -
                  receipts.totals.platformFeeReversalCents,
              ],
              ["Devolvido", receipts.totals.refundedCents],
              ["Líquido", receipts.totals.netCents],
            ].map(([label, value]) => (
              <div
                key={label as string}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <p className="text-xs font-semibold uppercase text-slate-500">
                  {label}
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {formatCents(value as number)}
                </p>
              </div>
            ))}
          </section>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-3">Pago em</th>
                  <th className="p-3">Devedor</th>
                  <th className="p-3">Pago</th>
                  <th className="p-3">Tarifa Efí</th>
                  <th className="p-3">Remuneração</th>
                  <th className="p-3">Líquido</th>
                  <th className="p-3">Situação</th>
                </tr>
              </thead>
              <tbody>
                {receipts.data.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-500">
                      Nenhum recebimento ainda.
                    </td>
                  </tr>
                )}
                {receipts.data.map((row) => (
                  <tr key={row.invoiceId} className="border-t border-slate-100">
                    <td className="p-3">{day(row.paidAt)}</td>
                    <td className="p-3">
                      {row.debtorName}
                      <span className="block text-xs text-slate-500">
                        {row.billingMethod}
                      </span>
                    </td>
                    <td className="p-3">{formatCents(row.paidAmountCents)}</td>
                    <td className="p-3">
                      {formatCents(row.efiFeeCents)}
                      {row.efiFeeEstimated && (
                        <span className="block text-xs text-slate-500">
                          estimada
                        </span>
                      )}
                    </td>
                    <td className="p-3">{formatCents(row.platformFeeCents)}</td>
                    <td className="p-3 font-medium">
                      {formatCents(row.netCents)}
                    </td>
                    <td className="p-3">{SITUATION_LABELS[row.situation]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {receipts.total > receipts.pageSize && (
            <div className="flex items-center gap-3 text-sm">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="rounded border px-3 py-1 disabled:opacity-50"
              >
                Anterior
              </button>
              <span>
                Página {page} de {Math.ceil(receipts.total / receipts.pageSize)}
              </span>
              <button
                type="button"
                disabled={page * receipts.pageSize >= receipts.total}
                onClick={() => setPage(page + 1)}
                className="rounded border px-3 py-1 disabled:opacity-50"
              >
                Próxima
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
