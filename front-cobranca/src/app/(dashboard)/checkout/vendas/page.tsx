"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { AlertTriangle, Loader2, Receipt } from "lucide-react";
import type { CheckoutBalance, CheckoutSale, CheckoutSaleStatus, CheckoutSalesPage } from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";
import { formatCents, formatDateTime } from "@/lib/disbursements";
import {
  buttonClass,
  inputClass,
  messageOf,
  NoticeText,
  secondaryButtonClass,
  type Notice,
} from "@/components/features/checkout/ui";

const STATUS_LABELS: Record<CheckoutSaleStatus, string> = {
  PAID: "Paga",
  REFUNDED: "Reembolsada",
  CHARGEBACK: "Contestada",
};
const PERIODS = [
  { value: "30", label: "Últimos 30 dias" },
  { value: "90", label: "Últimos 90 dias" },
  { value: "all", label: "Todo o período" },
] as const;
const PAGE_SIZE = 20;

function since(days: string): string | undefined {
  if (days === "all") return undefined;
  return new Date(Date.now() - Number(days) * 86_400_000).toISOString();
}

function BalanceCard({ label, cents, detail }: { label: string; cents: number; detail?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${cents < 0 ? "text-red-600" : "text-slate-900"}`}>{formatCents(cents)}</p>
      {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
    </div>
  );
}

function RefundForm({ sale, onDone }: { sale: CheckoutSale; onDone: (notice: Notice) => void }) {
  const api = useApiClient();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.requestCheckoutRefund(sale.orderId, reason);
      onDone({ error: false, text: "Pedido de reembolso enviado. A Cifra+ faz a devolução e a venda sai do saldo." });
    } catch (caught) {
      setError(messageOf(caught, "Não foi possível pedir o reembolso."));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-2 rounded-md bg-slate-50 p-3">
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Motivo do reembolso
        <textarea className={`${inputClass} h-20 py-2`} value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} required />
      </label>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className={buttonClass} disabled={saving || reason.trim().length < 5}>
          {saving && <Loader2 size={16} className="animate-spin" />}
          Enviar pedido
        </button>
        <button type="button" className={secondaryButtonClass} onClick={() => onDone(null)}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export default function CheckoutSalesPage() {
  const api = useApiClient();
  const [period, setPeriod] = useState<string>("30");
  const [status, setStatus] = useState<CheckoutSaleStatus | "">("");
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [balance, setBalance] = useState<CheckoutBalance | null>(null);
  const [sales, setSales] = useState<CheckoutSalesPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  function load(change: () => void): void {
    setSales(null);
    setError(null);
    change();
  }

  useEffect(() => {
    // A slower answer for previous filters must not replace the current one.
    const controller = new AbortController();
    Promise.all([
      api.getCheckoutBalance(controller.signal),
      api.listCheckoutSales(
        { from: since(period), status: status || undefined, page, pageSize: PAGE_SIZE },
        controller.signal,
      ),
    ])
      .then(([loadedBalance, loadedSales]) => {
        setBalance(loadedBalance);
        setSales(loadedSales);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(messageOf(caught, "Não foi possível carregar as vendas."));
      });
    return () => controller.abort();
  }, [api, period, status, page, reload]);

  const pages = sales ? Math.max(1, Math.ceil(sales.total / sales.pageSize)) : 1;
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
          <Receipt size={20} />
        </span>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Vendas</h1>
          <p className="text-sm text-slate-500">Cada venda fica 7 dias a liberar antes de entrar no saldo para repasse.</p>
        </div>
      </header>

      {balance && (
        <section className="grid gap-3 sm:grid-cols-3">
          <BalanceCard
            label="A liberar"
            cents={balance.pendingCents}
            detail={balance.nextReleaseAt ? `Próxima liberação: ${formatDateTime(balance.nextReleaseAt)}` : undefined}
          />
          <BalanceCard label="Liberado para repasse" cents={balance.releasedCents} detail="Já descontados reembolsos e repasses." />
          <BalanceCard label="Repassado" cents={balance.paidOutCents} />
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <select aria-label="Período" className={`${inputClass} w-auto`} value={period} onChange={(event) => load(() => { setPage(1); setPeriod(event.target.value); })}>
          {PERIODS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <select aria-label="Situação" className={`${inputClass} w-auto`} value={status} onChange={(event) => load(() => { setPage(1); setStatus(event.target.value as CheckoutSaleStatus | ""); })}>
          <option value="">Todas as situações</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
      <NoticeText notice={notice} />

      {error ? (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertTriangle size={16} />
          {error}
          <button type="button" className="ml-auto font-semibold underline" onClick={() => load(() => setReload((value) => value + 1))}>
            Tentar de novo
          </button>
        </div>
      ) : !sales ? (
        <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Carregando vendas…</p>
      ) : sales.items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Nenhuma venda neste período.</p>
      ) : (
        <ul className="space-y-2">
          {sales.items.map((sale) => (
            <li key={sale.orderId} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{sale.items.map((line) => line.name).join(" + ")}</p>
                  <p className="text-sm text-slate-500">
                    {formatDateTime(sale.paidAt)} · {sale.buyer.name} · {sale.buyer.email} · {sale.buyer.phone}
                  </p>
                  <p className="text-xs text-slate-500">
                    {STATUS_LABELS[sale.status]}
                    {sale.couponCode && ` · cupom ${sale.couponCode}`}
                    {sale.utm?.utm_source && ` · origem ${sale.utm.utm_source}`}
                    {sale.availableAt && sale.status === "PAID" && ` · libera em ${formatDateTime(sale.availableAt)}`}
                    {sale.openRefundRequest && " · reembolso pedido"}
                  </p>
                </div>
                <dl className="grid shrink-0 grid-cols-2 gap-x-4 text-right text-sm sm:grid-cols-4">
                  <div><dt className="text-xs text-slate-500">Pago</dt><dd>{formatCents(sale.totalCents)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Tarifa Efí</dt><dd>− {formatCents(sale.efiFeeCents)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Cifra+</dt><dd>− {formatCents(sale.platformFeeCents)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Líquido</dt><dd className="font-semibold">{formatCents(sale.netCents)}</dd></div>
                </dl>
              </div>
              {sale.refundedCents > 0 && <p className="mt-1 text-xs text-slate-500">Reembolsado: {formatCents(sale.refundedCents)}</p>}
              {sale.status === "PAID" && !sale.openRefundRequest && refunding !== sale.orderId && (
                <button type="button" className="mt-2 text-sm font-semibold text-slate-600 hover:underline" onClick={() => setRefunding(sale.orderId)}>
                  Pedir reembolso
                </button>
              )}
              {refunding === sale.orderId && (
                <RefundForm
                  sale={sale}
                  onDone={(next) => {
                    setRefunding(null);
                    if (next) {
                      setNotice(next);
                      load(() => setReload((value) => value + 1));
                    }
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {sales && pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button type="button" className={secondaryButtonClass} disabled={page <= 1} onClick={() => load(() => setPage((value) => value - 1))}>Anterior</button>
          <span>Página {page} de {pages}</span>
          <button type="button" className={secondaryButtonClass} disabled={page >= pages} onClick={() => load(() => setPage((value) => value + 1))}>Próxima</button>
        </div>
      )}
    </div>
  );
}
