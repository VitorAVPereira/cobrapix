"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import {
  cancelCheckoutSubscription,
  CheckoutPublicError,
  formatBRL,
  getCheckoutSubscription,
  periodPriceLabel,
  type PublicCheckoutSubscription,
} from "@/lib/checkout-public";
import { CheckoutShell } from "./CheckoutShell";

type Loaded =
  | { kind: "loading" }
  | { kind: "ok"; subscription: PublicCheckoutSubscription }
  | { kind: "missing" }
  | { kind: "error" };

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

const STATUS: Record<PublicCheckoutSubscription["status"], string> = {
  PENDING: "Aguardando o primeiro pagamento",
  ACTIVE: "Ativa",
  PAST_DUE: "Pagamento em atraso",
  CANCELED: "Cancelada",
};

/**
 * The buyer's subscription, opened by the e-mail link: what is charged and
 * when, and the way to stop the renewals. The access goes on until the end
 * of the period already paid.
 */
export function SubscriptionPage({ token }: { token: string }) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (signal?: AbortSignal) =>
      getCheckoutSubscription(token, signal)
        .then((subscription) => setLoaded({ kind: "ok", subscription }))
        .catch((caught: unknown) => {
          if (signal?.aborted) return;
          setLoaded(
            caught instanceof CheckoutPublicError && caught.status === 404 ? { kind: "missing" } : { kind: "error" },
          );
        }),
    [token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function cancel() {
    setError(null);
    setSending(true);
    try {
      setLoaded({ kind: "ok", subscription: await cancelCheckoutSubscription(token) });
      setConfirming(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível cancelar agora. Tente de novo.");
    } finally {
      setSending(false);
    }
  }

  const subscription = loaded.kind === "ok" ? loaded.subscription : null;
  const page = subscription
    ? {
        displayName: subscription.seller.displayName ?? "",
        logoUrl: null,
        supportEmail: subscription.seller.supportEmail,
        supportWhatsapp: subscription.seller.supportWhatsapp,
      }
    : null;
  const canCancel = subscription?.status === "ACTIVE" || subscription?.status === "PAST_DUE";

  return (
    <CheckoutShell page={page}>
      <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 sm:p-7">
        {loaded.kind === "loading" && (
          <p className="flex items-center gap-2 text-sm text-neutral-500">
            <Loader2 size={16} className="animate-spin" /> Carregando sua assinatura…
          </p>
        )}
        {loaded.kind === "missing" && (
          <p role="alert" className="text-sm text-neutral-700">
            Não encontramos esta assinatura. Confira o link do e-mail.
          </p>
        )}
        {loaded.kind === "error" && (
          <p role="alert" className="text-sm text-red-600">
            Não foi possível carregar a assinatura agora. Tente de novo em instantes.
          </p>
        )}
        {subscription && (
          <>
            <div>
              <h1 className="text-[15px] font-semibold text-neutral-900">{subscription.productName}</h1>
              <p className="text-sm text-neutral-500">Plano {subscription.planName}</p>
            </div>
            <dl className="space-y-1 text-sm text-neutral-700">
              <div className="flex justify-between gap-2">
                <dt>Situação</dt>
                <dd className="font-medium text-neutral-900">{STATUS[subscription.status]}</dd>
              </div>
              {subscription.cycleCents !== null && (
                <div className="flex justify-between gap-2">
                  <dt>Valor</dt>
                  <dd>
                    {formatBRL(subscription.cycleCents)} {periodPriceLabel(subscription.intervalMonths)}
                  </dd>
                </div>
              )}
              {canCancel && subscription.currentPeriodEnd && (
                <div className="flex justify-between gap-2">
                  <dt>Próxima cobrança</dt>
                  <dd>{formatDate(subscription.currentPeriodEnd)}</dd>
                </div>
              )}
              {subscription.status === "CANCELED" && subscription.accessEndsAt && (
                <div className="flex justify-between gap-2">
                  <dt>Acesso até</dt>
                  <dd>{formatDate(subscription.accessEndsAt)}</dd>
                </div>
              )}
            </dl>

            {subscription.status === "CANCELED" && (
              <p role="status" className="flex items-start gap-2 rounded-lg bg-neutral-50 p-3 text-sm text-neutral-700">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-green-600" />
                Sua assinatura está cancelada e não será cobrada de novo.
              </p>
            )}

            {canCancel && !confirming && (
              <button
                type="button"
                className="h-11 w-full rounded-lg border border-neutral-300 text-sm font-semibold text-neutral-900 hover:bg-neutral-50"
                onClick={() => setConfirming(true)}
              >
                Cancelar assinatura
              </button>
            )}
            {canCancel && confirming && (
              <div className="space-y-3 rounded-lg border border-neutral-200 p-4">
                <p className="text-sm text-neutral-700">
                  Ao cancelar, as próximas cobranças param.
                  {subscription.currentPeriodEnd
                    ? ` Você continua com acesso até ${formatDate(subscription.currentPeriodEnd)}.`
                    : ""}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-neutral-950 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-60"
                    disabled={sending}
                    onClick={() => void cancel()}
                  >
                    {sending && <Loader2 size={16} className="animate-spin" />}
                    Confirmar cancelamento
                  </button>
                  <button
                    type="button"
                    className="h-11 flex-1 rounded-lg border border-neutral-300 text-sm font-semibold text-neutral-900"
                    disabled={sending}
                    onClick={() => setConfirming(false)}
                  >
                    Manter assinatura
                  </button>
                </div>
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
          </>
        )}
      </section>
    </CheckoutShell>
  );
}
