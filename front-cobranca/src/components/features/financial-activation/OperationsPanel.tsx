"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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

type Classification =
  | "REJECTED"
  | "CONFIRMATION_PENDING"
  | "MISSING_REFERENCE"
  | "MODE_MISMATCH"
  | "ISSUED";

interface AttentionCharge {
  id: string;
  invoiceId: string;
  billingMethod: string;
  status: string;
  gatewayStatusRaw: string | null;
  grossAmountCents: number;
  createdAt: string;
  classification?: Classification;
  hasProviderReference?: boolean;
  diagnosis?: {
    at: string;
    kind: string | null;
    code: string | null;
    stage: string | null;
    field: string | null;
    message: string | null;
  } | null;
  lastReconciliation?: { at: string; reasonCode: string | null } | null;
  actions?: string[];
}

interface ReconcileResult {
  status: string;
  reasonCode?: string;
  recommendedAction?: string;
}

type Tone = "success" | "info" | "warning";

const HEALTH_LABELS: Record<string, string> = {
  HEALTHY: "Saudável",
  DEGRADED: "Degradada (uma falha)",
  UNAVAILABLE: "Indisponível — emissões bloqueadas",
  UNHEALTHY: "Indisponível — emissões bloqueadas",
  UNKNOWN: "Ainda não verificada",
};

const CLASSIFICATION_LABELS: Record<Classification, string> = {
  REJECTED: "Emissão rejeitada",
  CONFIRMATION_PENDING: "Confirmação da emissão pendente",
  MISSING_REFERENCE: "Referência da Efí necessária",
  MODE_MISMATCH: "Modalidade diferente da solicitada",
  ISSUED: "Emitida — aguardando pagamento",
};

const STAGE_LABELS: Record<string, string> = {
  PRE_SUBMISSION: "antes do envio à Efí",
  PROVIDER_REQUEST: "no envio à Efí",
  PROVIDER_RESPONSE: "depois do aceite da Efí",
  LOCAL_PERSISTENCE: "na gravação local, depois do aceite da Efí",
};

const REASON_LABELS: Record<string, string> = {
  PROVIDER_NOT_FOUND: "A Efí não possui essa emissão na conta emissora.",
  ISSUANCE_TOO_RECENT: "Tentativa recente; consulte novamente em alguns minutos.",
  PROVIDER_DUPLICATE_ISSUANCE: "Há mais de uma cobrança na Efí com o identificador desta tentativa.",
  PROVIDER_AMOUNT_MISMATCH: "O valor na Efí é diferente do valor desta cobrança.",
  PROVIDER_REFERENCE_MISMATCH: "A cobrança encontrada na Efí não corresponde a esta tentativa.",
  MODALITY_MISMATCH: "A Efí emitiu boleto sem Pix, mas foi solicitado Bolix.",
  INSTRUMENTS_MISSING: "A Efí não devolveu linha digitável ou link do boleto.",
  PIX_SPLIT_LINK_UNVERIFIED: "O Pix está ativo na Efí, mas a consulta não comprova o vínculo do split.",
  PROVIDER_STATUS_UNKNOWN: "Situação da Efí não reconhecida.",
  PROVIDER_STATE_DIVERGENT: "A Efí mostra a cobrança pagável, mas ela está encerrada aqui.",
  MISSING_PROVIDER_REFERENCE: "Não há referência da Efí para consultar.",
  ISSUANCE_RECOVERED: "Emissão localizada na Efí e confirmada, sem novo envio.",
  ALREADY_ACTIVE: "A emissão já estava confirmada.",
  ALREADY_FINALIZED: "A cobrança já havia sido encerrada (por exemplo, pagamento recebido pelo webhook).",
};

const ACTION_HINTS: Record<string, string> = {
  REISSUE: "A reserva foi liberada: corrija o cadastro, se preciso, e emita a fatura novamente.",
  WAIT_AND_RECONCILE: "Aguarde e consulte novamente.",
  CONTACT_EFI: "Confira no painel da conta emissora e, se necessário, acione a Efí.",
  REVIEW_ACCOUNT_MODALITY: "Revise a chave Pix/Bolix da conta emissora antes de novas emissões.",
  CHECK_EFI_PANEL: "Confira o split no painel da Efí antes de disponibilizar o Pix.",
};

const TONE_CLASSES: Record<Tone, string> = {
  success: "text-emerald-700",
  info: "text-slate-700",
  warning: "text-amber-800",
};

// Brasília time with the zone spelled out, to compare with UTC logs.
function when(value: string | null | undefined): string {
  return value
    ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", timeZoneName: "short" })
    : "—";
}

function classify(charge: AttentionCharge): Classification | null {
  return charge.classification ?? null;
}

// REVIEW_REQUIRED is never presented as a success.
function describeResult(result: ReconcileResult): { text: string; tone: Tone } {
  const reason = result.reasonCode ? REASON_LABELS[result.reasonCode] ?? result.reasonCode : "";
  const hint = result.recommendedAction ? ACTION_HINTS[result.recommendedAction] ?? "" : "";
  const detail = [reason, hint].filter(Boolean).join(" ");
  if (result.status === "ACTIVE" || result.status === "PAID")
    return { text: `Conciliada com a Efí: ${result.status}. ${detail}`.trim(), tone: "success" };
  if (result.status === "REVIEW_REQUIRED")
    return { text: `Revisão necessária. ${detail}`.trim(), tone: "warning" };
  return { text: `Conciliada com a Efí: ${result.status}. ${detail}`.trim(), tone: "info" };
}

function ChargeRow({
  charge,
  busy,
  onReconcile,
}: {
  charge: AttentionCharge;
  busy: boolean;
  onReconcile: () => void;
}): ReactNode {
  const classification = classify(charge);
  const rejected = classification === "REJECTED";
  const diagnosis = charge.diagnosis;
  const reconciliation = charge.lastReconciliation;
  const canReconcile = charge.actions ? charge.actions.includes("RECONCILE") : true;
  return (
    <li
      className={`flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3 ${
        rejected ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50"
      }`}
    >
      <div className="min-w-0 space-y-1">
        <p className="font-medium text-slate-900">
          {classification ? CLASSIFICATION_LABELS[classification] : charge.gatewayStatusRaw ?? charge.status}
          <span className="font-normal text-slate-700">
            {" "}
            · {charge.billingMethod} · {formatCents(charge.grossAmountCents)} · fatura {charge.invoiceId.slice(0, 8)} ·
            tentativa {charge.id.slice(0, 8)}
          </span>
        </p>
        <p className="text-slate-600">
          Iniciada em {when(charge.createdAt)} · situação local {charge.status}
          {charge.gatewayStatusRaw ? ` (${charge.gatewayStatusRaw})` : ""}
        </p>
        <p className="text-slate-700">
          Motivo:{" "}
          {diagnosis?.message ?? "Motivo original não registrado."}
          {diagnosis?.code
            ? ` [${diagnosis.code}${diagnosis.stage ? `, ${STAGE_LABELS[diagnosis.stage] ?? diagnosis.stage}` : ""}]`
            : ""}
        </p>
        {reconciliation && (
          <p className="text-slate-700">
            Última consulta à Efí: {when(reconciliation.at)} —{" "}
            {reconciliation.reasonCode
              ? REASON_LABELS[reconciliation.reasonCode] ?? reconciliation.reasonCode
              : "sem conclusão"}
          </p>
        )}
        {classification === "MISSING_REFERENCE" && (
          <p className="text-xs text-slate-500">
            Sem identificador da Efí: a consulta procura a emissão pelo identificador desta tentativa na conta
            emissora original.
          </p>
        )}
      </div>
      {canReconcile && (
        <button
          type="button"
          disabled={busy}
          onClick={onReconcile}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          Conciliar com a Efí
        </button>
      )}
    </li>
  );
}

// Day-to-day operation of an active company: integration health on demand and
// issuances that need reconciliation. Nothing here resubmits a charge.
export function OperationsPanel({ companyId }: { companyId: string }): ReactNode {
  const api = useApiClient();
  const [health, setHealth] = useState<GatewayHealth | null>(null);
  const [charges, setCharges] = useState<AttentionCharge[]>([]);
  const [message, setMessage] = useState<{ text: string; tone: Tone } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Blocks a second click before the disabled state renders.
  const running = useRef(false);
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

  async function run(action: () => Promise<{ text: string; tone: Tone }>): Promise<void> {
    if (running.current) return;
    running.current = true;
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
      running.current = false;
      setBusy(false);
    }
  }

  const reconcile = (charge: AttentionCharge) =>
    void run(async () =>
      describeResult(
        await api.financialAdmin<ReconcileResult>(
          `${chargesPath}/${encodeURIComponent(charge.id)}/reconcile`,
          "POST",
        ),
      ),
    );

  const open = charges.filter((charge) => classify(charge) !== "REJECTED");
  const rejected = charges.filter((charge) => classify(charge) === "REJECTED");

  return (
    <section aria-label="Operação" className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 text-sm">
      <h2 className="text-lg font-semibold text-slate-900">Operação</h2>
      {error && <p role="alert" className="text-rose-700">{error}</p>}
      {message && (
        <p role="status" className={TONE_CLASSES[message.tone]}>
          {message.text}
        </p>
      )}
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
            return { text: "Checagem de saúde concluída.", tone: "success" };
          })
        }
        className="rounded-lg border border-slate-300 px-3 py-2 font-semibold disabled:opacity-50"
      >
        Validar integração agora
      </button>

      <h3 className="pt-2 font-semibold text-slate-800">Emissões para conciliar</h3>
      {open.length === 0 ? (
        <p className="text-slate-500">Nenhuma emissão incerta ou parada.</p>
      ) : (
        <ul className="space-y-2">
          {open.map((charge) => (
            <ChargeRow key={charge.id} charge={charge} busy={busy} onReconcile={() => reconcile(charge)} />
          ))}
        </ul>
      )}
      {rejected.length > 0 && (
        <>
          <h3 className="pt-2 font-semibold text-slate-800">Rejeições recentes (30 dias)</h3>
          <ul className="space-y-2">
            {rejected.map((charge) => (
              <ChargeRow key={charge.id} charge={charge} busy={busy} onReconcile={() => reconcile(charge)} />
            ))}
          </ul>
        </>
      )}
      <p className="text-xs text-slate-500">
        A conciliação apenas consulta a Efí na conta que emitiu a cobrança; nenhuma cobrança é reenviada. Emissão,
        pagamento e recebimento do split são conferidos separadamente.
      </p>
    </section>
  );
}
