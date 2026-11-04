"use client";

import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Loader2, Wallet } from "lucide-react";
import type { CheckoutFinanceOverview, CheckoutRefundRequestRow } from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";
import { formatCents, formatDateTime, parseAmountToCents } from "@/lib/disbursements";
import { formatPercentageBps } from "@/lib/billing-fees";
import { centsToInput } from "@/lib/checkout";
import { buttonClass, Field, inputClass, messageOf, NoticeText, secondaryButtonClass, type Notice } from "./ui";

const ENTRY_LABELS: Record<string, string> = { PAYOUT: "Repasse", ADJUSTMENT: "Ajuste", CHARGEBACK: "Contestação" };
const ORIGIN_LABELS = { BUYER: "comprador", SELLER: "vendedor" } as const;
const STATUS_LABELS = { REQUESTED: "Aguardando", DONE: "Reembolsado", REJECTED: "Recusado" } as const;

function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

/** A form that sends one money entry; the key changes only after a success. */
function MoneyForm({
  title,
  submitLabel,
  children,
  onSubmit,
}: {
  title: string;
  submitLabel: string;
  children: ReactNode;
  onSubmit: (idempotencyKey: string, form: FormData) => Promise<Notice>;
}) {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSaving(true);
    setNotice(null);
    try {
      setNotice(await onSubmit(key, new FormData(form)));
      setKey(crypto.randomUUID());
      form.reset();
    } catch (caught) {
      setNotice({ error: true, text: messageOf(caught, "Não foi possível registrar.") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border border-slate-200 p-4">
      <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
      <NoticeText notice={notice} />
      <button type="submit" className={buttonClass} disabled={saving}>
        {saving && <Loader2 size={16} className="animate-spin" />}
        {submitLabel}
      </button>
    </form>
  );
}

function amountOf(form: FormData, name = "amount"): number {
  const cents = parseAmountToCents(String(form.get(name) ?? ""));
  if (!cents) throw new Error("Informe o valor em reais.");
  return cents;
}

function RefundRequest({
  request,
  companyId,
  onChanged,
}: {
  request: CheckoutRefundRequestRow;
  companyId: string;
  onChanged: (notice: Notice) => void;
}) {
  const api = useApiClient();
  const [mode, setMode] = useState<"refund" | "reject" | null>(null);
  const [key] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      if (mode === "refund") {
        await api.recordCheckoutOrderMoney(companyId, "refunds", {
          idempotencyKey: key,
          orderId: request.order.id,
          amountCents: amountOf(form),
          reference: String(form.get("reference") ?? "") || undefined,
        });
        onChanged({ error: false, text: "Reembolso registrado e descontado do saldo." });
      } else {
        await api.rejectCheckoutRefundRequest(companyId, request.id, String(form.get("note") ?? ""));
        onChanged({ error: false, text: "Pedido de reembolso recusado." });
      }
    } catch (caught) {
      setError(messageOf(caught, "Não foi possível concluir."));
      setBusy(false);
    }
  }

  return (
    <li className="rounded-md border border-slate-200 p-3 text-sm">
      <p className="font-medium text-slate-900">
        {request.order.buyerName} · {formatCents(request.order.totalCents)} · pedido pelo {ORIGIN_LABELS[request.origin]} em{" "}
        {formatDateTime(request.createdAt)} · {STATUS_LABELS[request.status]}
      </p>
      <p className="mt-1 whitespace-pre-line text-slate-600">{request.reason}</p>
      {request.resolutionNote && <p className="mt-1 text-slate-500">Resposta: {request.resolutionNote}</p>}
      {request.status === "REQUESTED" && !mode && (
        <div className="mt-2 flex flex-wrap gap-3">
          <button type="button" className="font-semibold text-emerald-700 hover:underline" onClick={() => setMode("refund")}>
            Registrar devolução feita por fora
          </button>
          <button type="button" className="font-semibold text-slate-600 hover:underline" onClick={() => setMode("reject")}>
            Recusar
          </button>
        </div>
      )}
      {mode && (
        <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2">
          {mode === "refund" ? (
            <>
              <Field label="Valor devolvido (R$)">
                <input name="amount" className={inputClass} defaultValue={centsToInput(request.order.totalCents)} required />
              </Field>
              <Field label="Referência do comprovante">
                <input name="reference" className={inputClass} />
              </Field>
            </>
          ) : (
            <Field label="Motivo da recusa">
              <input name="note" className={inputClass} minLength={5} required />
            </Field>
          )}
          <button type="submit" className={buttonClass} disabled={busy}>Confirmar</button>
          <button type="button" className={secondaryButtonClass} onClick={() => setMode(null)}>Cancelar</button>
          {error && <p role="alert" className="w-full text-sm text-red-600">{error}</p>}
        </form>
      )}
    </li>
  );
}

/** Admin view of one checkout client's money. */
export function FinancePanel({ companyId }: { companyId: string }) {
  const api = useApiClient();
  const [data, setData] = useState<CheckoutFinanceOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .getCheckoutFinance(companyId, controller.signal)
      .then((result) => setData(result))
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(messageOf(caught, "Não foi possível carregar o financeiro."));
      });
    return () => controller.abort();
  }, [api, companyId, reload]);

  const refresh = (next: Notice = null) => {
    setNotice(next);
    setError(null);
    setReload((value) => value + 1);
  };

  if (error) return <p role="alert" className="text-sm text-red-600">{error}</p>;
  if (!data)
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 size={16} className="animate-spin" /> Carregando financeiro…
      </p>
    );
  const pending = data.refundRequests.filter((request) => request.status === "REQUESTED");
  const sales = data.sales.items.filter((sale) => sale.status !== "CHARGEBACK");
  return (
    <section className="space-y-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <Wallet size={16} /> Financeiro
      </h3>
      <dl className="grid gap-2 text-sm sm:grid-cols-4">
        <div className="rounded-md bg-slate-50 p-3"><dt className="text-slate-500">A liberar</dt><dd className="font-semibold">{formatCents(data.balance.pendingCents)}</dd></div>
        <div className="rounded-md bg-slate-50 p-3"><dt className="text-slate-500">Liberado</dt><dd className={`font-semibold ${data.balance.releasedCents < 0 ? "text-red-600" : ""}`}>{formatCents(data.balance.releasedCents)}</dd></div>
        <div className="rounded-md bg-slate-50 p-3"><dt className="text-slate-500">Repassado</dt><dd className="font-semibold">{formatCents(data.balance.paidOutCents)}</dd></div>
        <div className="rounded-md bg-slate-50 p-3">
          <dt className="text-slate-500">Chargeback ({data.chargebackIndex.windowDays} dias)</dt>
          <dd className={`font-semibold ${data.chargebackIndex.ratioBasisPoints >= 100 ? "text-red-600" : ""}`}>
            {formatPercentageBps(data.chargebackIndex.ratioBasisPoints)} · {data.chargebackIndex.chargebackCount} de {data.chargebackIndex.salesCount}
          </dd>
        </div>
      </dl>
      <NoticeText notice={notice} />

      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-800">Pedidos de reembolso ({pending.length} aguardando)</h4>
        <p className="text-xs text-slate-500">
          Devolva o Pix pelo app da Efí: quando a Efí confirma, o reembolso entra sozinho e o pedido se fecha. Registre aqui só
          devoluções feitas por fora da Efí.
        </p>
        {data.refundRequests.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum pedido de reembolso.</p>
        ) : (
          <ul className="space-y-2">
            {data.refundRequests.map((request) => (
              <RefundRequest key={request.id} request={request} companyId={companyId} onChanged={refresh} />
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <MoneyForm
          title="Registrar repasse"
          submitLabel="Registrar repasse"
          onSubmit={async (idempotencyKey, form) => {
            const result = await api.recordCheckoutPayout(companyId, {
              idempotencyKey,
              amountCents: amountOf(form),
              paidOn: String(form.get("paidOn") ?? today()),
              reference: String(form.get("reference") ?? "") || undefined,
              note: String(form.get("note") ?? "") || undefined,
            });
            refresh();
            return result.warning
              ? { error: true, text: `Repasse registrado. ${result.warning}` }
              : { error: false, text: "Repasse registrado." };
          }}
        >
          <Field label="Valor (R$)" hint={`Liberado: ${formatCents(data.balance.releasedCents)}`}>
            <input name="amount" className={inputClass} inputMode="decimal" required />
          </Field>
          <Field label="Data do Pix">
            <input name="paidOn" type="date" className={inputClass} defaultValue={today()} required />
          </Field>
          <Field label="Referência do comprovante">
            <input name="reference" className={inputClass} />
          </Field>
          <Field label="Observação" hint="Ex.: reserva de 1% retida por 30 dias.">
            <input name="note" className={inputClass} />
          </Field>
        </MoneyForm>

        <MoneyForm
          title="Registrar contestação (chargeback)"
          submitLabel="Registrar contestação"
          onSubmit={async (idempotencyKey, form) => {
            await api.recordCheckoutOrderMoney(companyId, "chargebacks", {
              idempotencyKey,
              orderId: String(form.get("orderId") ?? ""),
              amountCents: amountOf(form),
              reference: String(form.get("reference") ?? "") || undefined,
            });
            refresh();
            return { error: false, text: "Contestação registrada e descontada do saldo." };
          }}
        >
          <Field label="Venda">
            <select name="orderId" className={inputClass} required>
              <option value="">Escolha…</option>
              {sales.map((sale) => (
                <option key={sale.orderId} value={sale.orderId}>
                  {formatDateTime(sale.paidAt)} · {sale.buyer.name} · {formatCents(sale.totalCents)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Valor contestado (R$)">
            <input name="amount" className={inputClass} inputMode="decimal" required />
          </Field>
          <Field label="Referência da Efí">
            <input name="reference" className={inputClass} />
          </Field>
        </MoneyForm>

        <MoneyForm
          title="Registrar ajuste"
          submitLabel="Registrar ajuste"
          onSubmit={async (idempotencyKey, form) => {
            const sign = form.get("direction") === "credit" ? 1 : -1;
            await api.recordCheckoutAdjustment(companyId, {
              idempotencyKey,
              amountCents: sign * amountOf(form),
              note: String(form.get("note") ?? ""),
            });
            refresh();
            return { error: false, text: "Ajuste registrado." };
          }}
        >
          <Field label="Tipo">
            <select name="direction" className={inputClass} defaultValue="debit">
              <option value="debit">Descontar do vendedor</option>
              <option value="credit">Creditar ao vendedor</option>
            </select>
          </Field>
          <Field label="Valor (R$)">
            <input name="amount" className={inputClass} inputMode="decimal" required />
          </Field>
          <Field label="Motivo">
            <input name="note" className={inputClass} minLength={5} required />
          </Field>
        </MoneyForm>
      </div>

      {data.entries.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slate-800">Lançamentos do admin</h4>
          <ul className="mt-2 divide-y divide-slate-100 text-sm text-slate-600">
            {data.entries.map((entry) => (
              <li key={entry.id} className="py-2">
                {formatDateTime(entry.createdAt)} · {ENTRY_LABELS[entry.kind] ?? entry.kind} · {formatCents(entry.amountCents)}
                {entry.evidenceReference && ` · ${entry.evidenceReference}`}
                {entry.note && ` · ${entry.note}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
