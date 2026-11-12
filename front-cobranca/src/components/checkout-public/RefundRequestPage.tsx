"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import {
  CheckoutPublicError,
  formatBRL,
  getCheckoutOrder,
  requestCheckoutRefund,
  withdrawCheckoutRefund,
  type PublicCheckoutOrder,
} from "@/lib/checkout-public";
import { CheckoutShell } from "./CheckoutShell";

type Loaded = { kind: "loading" } | { kind: "ok"; order: PublicCheckoutOrder } | { kind: "missing" } | { kind: "error" };

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/**
 * The buyer asks for a refund (of the whole purchase or some items) and,
 * while it is open, may give it up. Only this page, opened by the buyer's
 * e-mail link, can withdraw a refund request.
 */
export function RefundRequestPage({ token }: { token: string }) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [reason, setReason] = useState("");
  const [chosen, setChosen] = useState<number[] | null>(null);
  const [sending, setSending] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    (signal?: AbortSignal) =>
      getCheckoutOrder(token, signal)
        .then((order) => setLoaded({ kind: "ok", order }))
        .catch((caught: unknown) => {
          if (signal?.aborted) return;
          setLoaded(caught instanceof CheckoutPublicError && caught.status === 404 ? { kind: "missing" } : { kind: "error" });
        }),
    [token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const order = loaded.kind === "ok" ? loaded.order : null;
  const refunded = order?.refund?.refundedItemIndexes ?? [];
  const available = (order?.items ?? []).map((_, index) => index).filter((index) => !refunded.includes(index));
  // Everything still refundable is chosen until the buyer unticks something.
  const selected = chosen ?? available;
  const amount = (order?.items ?? []).reduce(
    (sum, line, index) => sum + (selected.includes(index) ? line.refundCents ?? 0 : 0),
    0,
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSending(true);
    try {
      // All that is left is the whole order: no item list.
      const whole = selected.length === available.length;
      await requestCheckoutRefund(token, reason, whole ? [] : selected);
      setNotice("Pedido recebido. Enviamos os detalhes para o seu e-mail.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível enviar o pedido.");
    } finally {
      setSending(false);
    }
  }

  async function withdraw() {
    setError(null);
    setSending(true);
    try {
      await withdrawCheckoutRefund(token);
      setConfirmWithdraw(false);
      setNotice("Você desistiu do reembolso. Sua compra continua valendo.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível desistir agora. Tente de novo.");
    } finally {
      setSending(false);
    }
  }

  if (!order)
    return (
      <CheckoutShell page={null}>
        {loaded.kind === "loading" ? (
          <p className="flex items-center justify-center gap-2 py-20 text-neutral-500">
            <Loader2 size={18} className="animate-spin" /> Carregando…
          </p>
        ) : (
          <p role="alert" className="rounded-lg bg-white p-6 text-center text-neutral-700 shadow-sm">
            {loaded.kind === "missing" ? "Pedido não encontrado." : "Não foi possível carregar o pedido. Tente de novo."}
          </p>
        )}
      </CheckoutShell>
    );

  const color = order.page?.primaryColor ?? "#0F766E";
  const open = order.refund?.open ?? null;
  const openNames = open
    ? (open.itemIndexes.length ? open.itemIndexes : order.items.map((_, index) => index))
        .map((index) => order.items[index]?.name)
        .filter(Boolean)
        .join(" + ")
    : "";
  return (
    <CheckoutShell page={order.page}>
      <section className="space-y-4 rounded-lg bg-white p-5 shadow-sm">
        <h1 className="text-lg font-semibold text-neutral-900">{open ? "Seu pedido de reembolso" : "Pedir reembolso"}</h1>
        <p className="text-sm text-neutral-600">
          {order.items.map((line) => line.name).join(" + ")} · {formatBRL(order.totalCents)}
        </p>
        {notice && (
          <p role="status" className="flex items-start gap-2 text-sm text-emerald-700">
            <CheckCircle2 size={18} className="shrink-0" />
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        {open ? (
          <div className="space-y-3">
            <p className="text-sm text-neutral-700">
              Reembolso de {openNames}
              {open.amountCents !== null && <> · {formatBRL(open.amountCents)}</>}.
            </p>
            <p className="text-sm text-neutral-600">
              {open.holdUntil
                ? `O vendedor pode falar com você até ${formatDate(open.holdUntil)}. Depois disso, a Cifra+ faz a devolução.`
                : "A Cifra+ está cuidando da devolução."}
            </p>
            {confirmWithdraw ? (
              <div className="space-y-2 rounded-md bg-neutral-50 p-3">
                <p className="text-sm text-neutral-700">Desistir do reembolso? Sua compra continua valendo.</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={sending}
                    onClick={() => void withdraw()}
                    className="flex h-11 flex-1 items-center justify-center gap-2 rounded-md font-semibold text-white disabled:opacity-60"
                    style={{ backgroundColor: color }}
                  >
                    {sending && <Loader2 size={18} className="animate-spin" />}
                    Sim, desistir
                  </button>
                  <button
                    type="button"
                    disabled={sending}
                    onClick={() => setConfirmWithdraw(false)}
                    className="h-11 flex-1 rounded-md border border-neutral-300 text-sm font-semibold text-neutral-700"
                  >
                    Manter o pedido
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmWithdraw(true)}
                className="h-11 w-full rounded-md border border-neutral-300 text-sm font-semibold text-neutral-700"
              >
                Desistir do reembolso
              </button>
            )}
          </div>
        ) : order.status !== "PAID" ? (
          <p role="alert" className="text-sm text-neutral-700">
            {order.status === "REFUNDED"
              ? "Esta compra já foi reembolsada."
              : "Esta compra não está paga, então não há o que reembolsar."}
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            {order.items.length > 1 && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-neutral-700">O que você quer devolver?</legend>
                {order.items.map((line, index) => (
                  <label key={`${line.kind}-${index}`} className="flex items-center gap-2 text-sm text-neutral-700">
                    <input
                      type="checkbox"
                      disabled={refunded.includes(index)}
                      checked={selected.includes(index)}
                      onChange={(event) =>
                        setChosen(
                          event.target.checked
                            ? [...selected, index].sort((a, b) => a - b)
                            : selected.filter((value) => value !== index),
                        )
                      }
                    />
                    {line.name}
                    {refunded.includes(index) ? " (já reembolsado)" : line.refundCents ? ` · ${formatBRL(line.refundCents)}` : ""}
                  </label>
                ))}
              </fieldset>
            )}
            {amount > 0 && <p className="text-sm text-neutral-700">Valor a devolver: {formatBRL(amount)}</p>}
            <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
              Conte o motivo
              <textarea
                className="h-28 w-full rounded-md border border-neutral-300 p-3 text-base text-neutral-900 outline-none focus:border-neutral-500"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                minLength={5}
                maxLength={1000}
                required
              />
            </label>
            <p className="text-xs text-neutral-500">
              Pelo Código de Defesa do Consumidor, você pode desistir em até 7 dias depois do pagamento.
            </p>
            <button
              type="submit"
              disabled={sending || reason.trim().length < 5 || selected.length === 0}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-md font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: color }}
            >
              {sending && <Loader2 size={18} className="animate-spin" />}
              Enviar pedido de reembolso
            </button>
          </form>
        )}
      </section>
    </CheckoutShell>
  );
}
