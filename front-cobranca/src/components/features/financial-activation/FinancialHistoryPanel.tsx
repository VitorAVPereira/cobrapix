"use client";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useApiClient } from "@/lib/use-api-client";
import { PROFILE_STATUS_LABELS } from "@/lib/financial-activation";
import type { FinancialProfileStatus } from "@/lib/financial-activation";
import type { FinancialHistory } from "@/lib/settlements";

const ACTION_LABELS: Record<string, string> = {
  FINANCIAL_ACTIVATION_CREATED: "Preparação iniciada",
  FINANCIAL_ACTIVATION_CONFIGURED: "Autorização e titularidade registradas",
  FINANCIAL_ACTIVATION_CREDENTIALS_UPLOADED: "Credenciais enviadas",
  FINANCIAL_ACTIVATION_ACTIVATED: "Financeiro ativado",
  FINANCIAL_ACTIVATION_CANCELED: "Preparação cancelada",
  FINANCIAL_ACTIVATION_EXPIRED: "Preparação expirada",
  PLATFORM_FEE_EVIDENCE_RECORDED: "Remuneração comprovada",
  SETTLEMENT_DIVERGENCE_RESOLVED: "Divergência decidida",
  SETTLEMENT_OPTIONS_UPDATED: "Opção de estorno alterada",
};

function when(value: string | null): string {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

// Only fields the server already redacted; rendered as plain text.
function describe(details: unknown): string {
  if (!details || typeof details !== "object") return "";
  return Object.entries(details as Record<string, unknown>)
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`,
    )
    .join(" · ");
}

export function FinancialHistoryPanel({
  companyId,
}: {
  companyId: string;
}): ReactNode {
  const api = useApiClient();
  const [history, setHistory] = useState<FinancialHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getFinancialHistory(companyId)
      .then(setHistory)
      .catch((caught: unknown) =>
        setError(
          caught instanceof Error
            ? caught.message
            : "Não foi possível carregar o histórico.",
        ),
      );
  }, [api, companyId]);

  return (
    <section
      aria-label="Histórico financeiro"
      className="rounded-xl border border-slate-200 bg-white p-5 text-sm"
    >
      <h2 className="text-lg font-semibold text-slate-900">Histórico</h2>
      {error && (
        <p role="alert" className="mt-2 text-rose-700">
          {error}
        </p>
      )}
      {history && (
        <>
          <h3 className="mt-4 font-semibold text-slate-800">
            Versões da ativação
          </h3>
          {history.versions.length === 0 && (
            <p className="text-slate-500">Nenhuma versão.</p>
          )}
          <ul className="mt-2 space-y-2">
            {history.versions.map((version) => (
              <li
                key={version.id}
                className="rounded-lg border border-slate-100 p-3"
              >
                <p className="font-medium text-slate-900">
                  Versão {version.version} ·{" "}
                  {PROFILE_STATUS_LABELS[
                    version.status as FinancialProfileStatus
                  ] ?? version.status}
                  {version.origin === "AUTOMATIC_OPENING"
                    ? " · abertura automática"
                    : " · ativação manual"}
                </p>
                <p className="text-slate-600">
                  Conta {version.issuerAccount ?? "—"} · credencial v
                  {version.credentialVersion ?? "—"}
                  {version.certificateExpiresAt
                    ? ` · certificado até ${when(version.certificateExpiresAt)}`
                    : ""}{" "}
                  ·{" "}
                  {version.environment === "PRODUCTION"
                    ? "produção"
                    : "homologação"}{" "}
                  · {version.enabledMethods.join(", ")}
                </p>
                <p className="text-slate-600">
                  Autorização: {version.authorizationReference ?? "—"} · ativada
                  em {when(version.activatedAt)}
                  {version.activatedBy ? ` por ${version.activatedBy}` : ""}
                  {version.supersededAt
                    ? ` · substituída em ${when(version.supersededAt)}`
                    : ""}
                  {version.canceledAt
                    ? ` · cancelada em ${when(version.canceledAt)} (${version.cancelReason ?? "sem motivo"})`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
          <h3 className="mt-4 font-semibold text-slate-800">Eventos</h3>
          {history.events.length === 0 && (
            <p className="text-slate-500">Nenhum evento.</p>
          )}
          <ul className="mt-2 space-y-1">
            {history.events.map((event) => (
              <li key={event.id} className="border-t border-slate-100 py-1.5">
                <span className="font-medium text-slate-800">
                  {ACTION_LABELS[event.action] ?? event.action}
                </span>
                <span className="text-slate-500">
                  {" "}
                  · {when(event.createdAt)}
                  {event.actor ? ` · ${event.actor}` : ""}
                </span>
                {describe(event.details) && (
                  <span className="block text-xs text-slate-500">
                    {describe(event.details)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
