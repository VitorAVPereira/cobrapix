"use client";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useApiClient } from "@/lib/use-api-client";
import { formatCents } from "@/lib/settlements";

interface GatewayHealth {
  status: string;
  environment: string;
  healthStatus: string;
  certificateExpiresAt: string | null;
  lastValidatedAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
}

interface AttentionCharge {
  id: string;
  invoiceId: string;
  billingMethod: string;
  status: string;
  gatewayStatusRaw: string | null;
  grossAmountCents: number;
  createdAt: string;
}

const HEALTH_LABELS: Record<string, string> = {
  HEALTHY: "Saudável",
  DEGRADED: "Degradada (uma falha)",
  UNAVAILABLE: "Indisponível — emissões bloqueadas",
  UNHEALTHY: "Indisponível — emissões bloqueadas",
  UNKNOWN: "Ainda não verificada",
};

function when(value: string | null): string {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

// Day-to-day operation of an active company: integration health on demand and
// issuances that need reconciliation. Nothing here resubmits a charge.
export function OperationsPanel({ companyId }: { companyId: string }): ReactNode {
  const api = useApiClient();
  const [health, setHealth] = useState<GatewayHealth | null>(null);
  const [charges, setCharges] = useState<AttentionCharge[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/admin/efi-onboarding/${encodeURIComponent(companyId)}`;
  const chargesPath = `/admin/payment-charges/${encodeURIComponent(companyId)}`;

  const load = useCallback(async () => {
    const [detail, attention] = await Promise.all([
      api.financialAdmin<{ gateway: GatewayHealth | null }>(base),
      api.financialAdmin<AttentionCharge[]>(`${chargesPath}/attention`),
    ]);
    setHealth(detail.gateway);
    setCharges(attention);
  }, [api, base, chargesPath]);

  useEffect(() => {
    load().catch((caught: unknown) =>
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar a operação."),
    );
  }, [load]);

  async function run(action: () => Promise<string>): Promise<void> {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await action();
      await load();
      setMessage(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "A operação não foi concluída.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Operação" className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 text-sm">
      <h2 className="text-lg font-semibold text-slate-900">Operação</h2>
      {error && <p role="alert" className="text-rose-700">{error}</p>}
      {message && <p role="status" className="text-emerald-700">{message}</p>}
      {health ? (
        <p className="text-slate-700">
          Integração: <strong>{HEALTH_LABELS[health.healthStatus] ?? health.healthStatus}</strong> · última
          checagem {when(health.lastValidatedAt)} · certificado até {when(health.certificateExpiresAt)}
          {health.consecutiveFailures > 0 ? ` · ${health.consecutiveFailures} falha(s) seguida(s)` : ""}
          {health.lastError ? ` · último erro ${health.lastError}` : ""}
        </p>
      ) : (
        <p className="text-slate-500">Sem integração ativa.</p>
      )}
      <button
        type="button"
        disabled={busy || !health}
        onClick={() =>
          void run(async () => {
            await api.financialAdmin(`${base}/validate`, "POST");
            return "Checagem de saúde concluída.";
          })
        }
        className="rounded-lg border border-slate-300 px-3 py-2 font-semibold disabled:opacity-50"
      >
        Validar integração agora
      </button>

      <h3 className="pt-2 font-semibold text-slate-800">Emissões para conciliar</h3>
      {charges.length === 0 ? (
        <p className="text-slate-500">Nenhuma emissão incerta ou parada.</p>
      ) : (
        <ul className="space-y-2">
          {charges.map((charge) => (
            <li key={charge.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <span>
                {charge.billingMethod} · {formatCents(charge.grossAmountCents)} · fatura{" "}
                {charge.invoiceId.slice(0, 8)} · {charge.gatewayStatusRaw ?? charge.status} desde{" "}
                {when(charge.createdAt)}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await api.financialAdmin<{ status: string }>(
                      `${chargesPath}/${encodeURIComponent(charge.id)}/reconcile`,
                      "POST",
                    );
                    return `Conciliada com a Efí: ${result.status}.`;
                  })
                }
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                Conciliar com a Efí
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-500">
        A conciliação só consulta a Efí pelo identificador já gravado; nenhuma
        cobrança é reenviada.
      </p>
    </section>
  );
}
