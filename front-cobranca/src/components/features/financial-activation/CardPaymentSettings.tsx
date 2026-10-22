"use client";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useApiClient } from "@/lib/use-api-client";
import type {
  CardSettingsOverview,
  CardAttempt,
  CardProcessingRates,
} from "@/lib/api-client";
// Efí list prices; each company may have negotiated different ones.
const efiDefaults = {
  cashBasisPoints: 349,
  anticipationBasisPoints: 129,
  upTo6BasisPoints: 399,
  upTo12BasisPoints: 439,
};
type RateField = keyof typeof efiDefaults;
const receiptLabels: Record<CardProcessingRates["receipt"], string> = {
  ANTICIPATED: "Valor total em até 31 dias (antecipado)",
  INSTALLMENTS: "Uma parcela a cada 31 dias",
};
function ProcessingRatesFields({
  stored,
}: {
  stored: CardProcessingRates | null;
}) {
  const [receipt, setReceipt] = useState(stored?.receipt ?? "ANTICIPATED");
  const input = (name: string, label: string, field: RateField) => (
    <label key={name} className="block">
      {label}
      <input
        name={name}
        type="number"
        min="0"
        max="99.99"
        step="0.01"
        required
        defaultValue={
          ((stored as Partial<Record<RateField, number>> | null)?.[field] ??
            efiDefaults[field]) / 100
        }
        className="ml-2 w-24 rounded border p-2"
      />
    </label>
  );
  return (
    <div className="space-y-3">
      <p className="font-medium">Recebimento na conta Efí</p>
      {(["ANTICIPATED", "INSTALLMENTS"] as const).map((value) => (
        <label key={value} className="flex gap-2">
          <input
            type="radio"
            name="receipt"
            value={value}
            checked={receipt === value}
            onChange={() => setReceipt(value)}
          />
          {receiptLabels[value]}
        </label>
      ))}
      {input("cash", "À vista (%)", "cashBasisPoints")}
      {receipt === "ANTICIPATED" ? (
        <>
          {input(
            "anticipation",
            "Por parcela antecipada (%)",
            "anticipationBasisPoints",
          )}
          <p className="text-xs text-slate-500">
            Em N parcelas, a antecipação é cobrada sobre N − 1 parcelas: a
            primeira já cai em 31 dias.
          </p>
        </>
      ) : (
        <>
          {input("upTo6", "Parcelado de 2x a 6x (%)", "upTo6BasisPoints")}
          {input("upTo12", "Parcelado de 7x a 12x (%)", "upTo12BasisPoints")}
        </>
      )}
    </div>
  );
}
const statusLabels: Record<string, string> = {
  SUBMITTING: "Enviando",
  UNCERTAIN: "Resultado incerto",
  APPROVED: "Aguardando confirmação",
  PAID: "Pago",
  DECLINED: "Não autorizado",
  CANCELED: "Cancelado",
};
export default function CardPaymentSettings({
  companyId,
}: {
  companyId: string;
}) {
  const api = useApiClient();
  const [data, setData] = useState<CardSettingsOverview | null>(null);
  const [attempts, setAttempts] = useState<CardAttempt[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [settings, rows] = await Promise.all([
      api.getCardPaymentSettings(companyId),
      api.getCardPaymentAttempts(companyId),
    ]);
    return { settings, rows };
  }, [api, companyId]);
  useEffect(() => {
    let current = true;
    load()
      .then((value) => {
        if (current) {
          setData(value.settings);
          setAttempts(value.rows);
          setError("");
        }
      })
      .catch(() => {
        if (current)
          setError("Não foi possível carregar a configuração de cartão.");
      });
    return () => {
      current = false;
    };
  }, [load]);
  const current = data?.settings.find(
    (s) => s.issuerIdentityId === data.activeIssuerIdentityId,
  );
  const legacyRates = Array.isArray(current?.processingRates);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data?.activeIssuerIdentityId || busy) return;
    const form = new FormData(event.currentTarget);
    const number = (name: string, scale = 100) =>
      Math.round(Number(form.get(name)) * scale);
    const cashBasisPoints = number("cash");
    const processingRates: CardProcessingRates =
      form.get("receipt") === "INSTALLMENTS"
        ? {
            receipt: "INSTALLMENTS",
            cashBasisPoints,
            upTo6BasisPoints: number("upTo6"),
            upTo12BasisPoints: number("upTo12"),
          }
        : {
            receipt: "ANTICIPATED",
            cashBasisPoints,
            anticipationBasisPoints: number("anticipation"),
          };
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.configureCardPayments(companyId, {
        issuerIdentityId: data.activeIssuerIdentityId,
        expectedVersion: current?.version ?? 0,
        enabled: form.has("enabled"),
        onTimeBasisPoints: number("onTime"),
        overdueBasisPoints: number("overdue"),
        validationReference: String(form.get("reference") ?? ""),
        processingRates,
      });
      const updated = await load();
      setData(updated.settings);
      setAttempts(updated.rows);
      setNotice(
        "Configuração salva. As taxas de Pix e Bolix foram preservadas.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar.");
      const updated = await load().catch(() => null);
      if (updated) setData(updated.settings);
    } finally {
      setBusy(false);
    }
  }
  async function reconcile(id: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const outcome = await api.reconcileCardPayment(companyId, id);
      setNotice(
        outcome.reviewRequired
          ? "A Efí ainda não confirmou o resultado. A tentativa permanece bloqueada para revisão."
          : "Situação atualizada na Efí.",
      );
      const updated = await load();
      setAttempts(updated.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível conciliar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold">Cartão de crédito</h2>
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-emerald-700">
          {notice}
        </p>
      )}
      {!data && !error && <p>Carregando configuração…</p>}
      {data?.activeIssuerIdentityId && (
        <form
          key={`${companyId}:${current?.version ?? 0}`}
          onSubmit={(e) => void save(e)}
          className="space-y-4 text-sm"
        >
          <p>
            Informe as tarifas de cartão negociadas com a Efí para esta empresa.
            Os valores iniciais são os da tabela padrão da Efí e valem para
            todas as bandeiras, em até 12x. A tarifa e os juros do parcelamento
            são somados ao valor pago pelo cliente. A remuneração Cifra+ é
            descontada da empresa por split, sobre o principal após descontos.
          </p>
          {legacyRates && (
            <p className="text-amber-700">
              As tarifas salvas estão no formato anterior (por bandeira, até
              6x) e continuam valendo até você salvar esta configuração.
            </p>
          )}
          <fieldset disabled={busy} className="space-y-3">
            <label className="flex gap-2">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={current?.enabled ?? false}
              />
              Habilitar cartão nesta conta
            </label>
            <label className="block">
              Cifra+ no prazo (%)
              <input
                name="onTime"
                type="number"
                min="0"
                max="100"
                step="0.01"
                required
                defaultValue={(current?.onTimeBasisPoints ?? 0) / 100}
                className="ml-2 rounded border p-2"
              />
            </label>
            <label className="block">
              Cifra+ em atraso (%)
              <input
                name="overdue"
                type="number"
                min="0"
                max="100"
                step="0.01"
                required
                defaultValue={(current?.overdueBasisPoints ?? 0) / 100}
                className="ml-2 rounded border p-2"
              />
            </label>
            <ProcessingRatesFields
              stored={
                current && !legacyRates
                  ? (current.processingRates as CardProcessingRates)
                  : null
              }
            />
            <label className="block">
              Referência da homologação e das tarifas contratadas
              <input
                name="reference"
                required
                minLength={3}
                maxLength={200}
                defaultValue={current?.validationReference}
                className="mt-1 w-full rounded border p-2"
              />
            </label>
            <p className="text-xs text-slate-500">
              Habilite somente após conferir parcelas, líquido recebido e split
              na conta emissora. Não registre credenciais nesta referência.
            </p>
            <button
              type="submit"
              className="rounded bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Salvando…" : "Salvar cartão"}
            </button>
          </fieldset>
        </form>
      )}
      {!!attempts.length && (
        <div className="space-y-2">
          <h3 className="font-semibold">Últimas tentativas</h3>
          {attempts.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 border-t py-2 text-sm"
            >
              <span>
                Fatura {row.invoiceId.slice(0, 8)} ·{" "}
                {row.reviewRequired
                  ? "Revisão necessária"
                  : (statusLabels[row.status] ?? row.status)}{" "}
                · {row.installments}x ·{" "}
                {(row.totalCents / 100).toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                })}
              </span>
              <button
                disabled={busy}
                onClick={() => void reconcile(row.id)}
                className="rounded border px-3 py-1"
              >
                Consultar Efí
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
