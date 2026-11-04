"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import {
  CheckoutPublicError,
  formatBRL,
  getCheckoutOrder,
  requestCheckoutRefund,
  type PublicCheckoutOrder,
} from "@/lib/checkout-public";
import { CheckoutShell } from "./CheckoutShell";

type Loaded = { kind: "loading" } | { kind: "ok"; order: PublicCheckoutOrder } | { kind: "missing" } | { kind: "error" };

/** The buyer asks for a refund; the Cifra+ team returns the Pix. */
export function RefundRequestPage({ token }: { token: string }) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getCheckoutOrder(token, controller.signal)
      .then((order) => setLoaded({ kind: "ok", order }))
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setLoaded(caught instanceof CheckoutPublicError && caught.status === 404 ? { kind: "missing" } : { kind: "error" });
      });
    return () => controller.abort();
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSending(true);
    try {
      await requestCheckoutRefund(token, reason);
      setSent(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível enviar o pedido.");
    } finally {
      setSending(false);
    }
  }

  if (loaded.kind !== "ok")
    return (
      <CheckoutShell page={null}>
        {loaded.kind === "loading" ? (
          <p className="flex items-center justify-center gap-2 py-20 text-slate-500">
            <Loader2 size={18} className="animate-spin" /> Carregando…
          </p>
        ) : (
          <p role="alert" className="rounded-lg bg-white p-6 text-center text-slate-700 shadow-sm">
            {loaded.kind === "missing" ? "Pedido não encontrado." : "Não foi possível carregar o pedido. Tente de novo."}
          </p>
        )}
      </CheckoutShell>
    );

  const { order } = loaded;
  const color = order.page?.primaryColor ?? "#0F766E";
  return (
    <CheckoutShell page={order.page}>
      <section className="space-y-4 rounded-lg bg-white p-5 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Pedir reembolso</h1>
        <p className="text-sm text-slate-600">
          {order.items.map((line) => line.name).join(" + ")} · {formatBRL(order.totalCents)}
        </p>
        {sent ? (
          <p role="status" className="flex items-start gap-2 text-sm text-emerald-700">
            <CheckCircle2 size={18} className="shrink-0" />
            Pedido recebido. A devolução é feita pelo mesmo Pix em até 7 dias úteis, e o vendedor pode entrar em contato antes.
          </p>
        ) : order.status !== "PAID" ? (
          <p role="alert" className="text-sm text-slate-700">
            {order.status === "REFUNDED"
              ? "Esta compra já foi reembolsada."
              : "Esta compra não está paga, então não há o que reembolsar."}
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Conte o motivo
              <textarea
                className="h-28 w-full rounded-md border border-slate-300 p-3 text-base text-slate-900 outline-none focus:border-slate-500"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                minLength={5}
                maxLength={1000}
                required
              />
            </label>
            <p className="text-xs text-slate-500">
              Pelo Código de Defesa do Consumidor, você pode desistir em até 7 dias depois do pagamento.
            </p>
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={sending || reason.trim().length < 5}
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
