"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import {
  acceptCheckoutOffer,
  periodPriceLabel,
  checkoutImageUrl,
  CheckoutPublicError,
  declineCheckoutOffer,
  formatBRL,
  getCheckoutOffer,
  openAccess,
  quoteCheckoutOfferCard,
  type OfferCardQuote,
  type PublicOffer,
} from "@/lib/checkout-public";
import { CheckoutShell } from "./CheckoutShell";

const ACCESS_DELAY_MS = 2_000;

const BRAND_LABELS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  elo: "Elo",
};

function remaining(expiresAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  const clock = `${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return hours ? `${hours}:${clock}` : clock;
}

type Loaded = { kind: "loading" } | { kind: "ok"; data: PublicOffer } | { kind: "missing" } | { kind: "error" };

/**
 * The one-click offer after a paid purchase: accept with the same card (the
 * buyer only picks the installments) or a new Pix, or decline and move on.
 */
export function OfferPage({ token, offerId }: { token: string; offerId: string | null }) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [method, setMethod] = useState<"CARD" | "PIX">("CARD");
  const [quote, setQuote] = useState<OfferCardQuote | null>(null);
  const [installments, setInstallments] = useState(1);
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Same key while the buyer retries one answer: a double click is one order.
  const acceptKey = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getCheckoutOffer(token, offerId, controller.signal)
      .then((data) => setLoaded({ kind: "ok", data }))
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setLoaded(caught instanceof CheckoutPublicError && caught.status === 404 ? { kind: "missing" } : { kind: "error" });
      });
    return () => controller.abort();
  }, [token, offerId]);

  const data = loaded.kind === "ok" ? loaded.data : null;
  const offer = data?.state === "OFFER" ? data.offer : null;
  const card = data?.payment?.card ?? null;
  const pixEnabled = Boolean(data?.payment?.pixEnabled);
  const chosen = card && method === "CARD" ? "CARD" : "PIX";
  const pendingOrder = data?.state === "OFFER" ? data.order : null;
  const accessUrl = data?.state === "DONE" ? data.accessUrl : null;

  useEffect(() => {
    // An order already started for this offer: follow its payment.
    if (pendingOrder) router.push(`/c/pedido/${pendingOrder.token}`);
  }, [pendingOrder, router]);

  useEffect(() => {
    if (!accessUrl) return;
    const timer = setTimeout(() => openAccess(accessUrl), ACCESS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [accessUrl]);

  useEffect(() => {
    if (!offer || !card) return;
    // The installments come from the server, for this offer on the kept card.
    const controller = new AbortController();
    setQuote(null);
    quoteCheckoutOfferCard(token, offer.id, controller.signal)
      .then((result) => {
        setQuote(result);
        setInstallments(result.options[0]?.installments ?? 1);
      })
      .catch(() => {
        if (!controller.signal.aborted) setMethod("PIX");
      });
    return () => controller.abort();
  }, [token, offer, card]);

  useEffect(() => {
    if (!data?.expiresAt || data.state !== "OFFER") return;
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, [data?.expiresAt, data?.state]);

  async function accept() {
    if (!offer) return;
    setError(null);
    setBusy("accept");
    acceptKey.current ??= crypto.randomUUID();
    try {
      const order = await acceptCheckoutOffer(token, {
        offerId: offer.id,
        method: chosen,
        ...(chosen === "CARD" && quote ? { quoteId: quote.quoteId, installments } : {}),
        idempotencyKey: acceptKey.current,
      });
      router.push(`/c/pedido/${order.token}`);
    } catch (caught) {
      acceptKey.current = null;
      setError(caught instanceof Error ? caught.message : "Não foi possível concluir. Tente de novo.");
      setBusy(null);
    }
  }

  async function decline() {
    if (!offer) return;
    setError(null);
    setBusy("decline");
    try {
      setLoaded({ kind: "ok", data: await declineCheckoutOffer(token, offer.id) });
      acceptKey.current = null;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível concluir. Tente de novo.");
    } finally {
      setBusy(null);
    }
  }

  if (loaded.kind !== "ok")
    return (
      <CheckoutShell page={null}>
        {loaded.kind === "loading" ? (
          <p className="flex items-center justify-center gap-2 py-20 text-neutral-500">
            <Loader2 size={18} className="animate-spin" /> Carregando…
          </p>
        ) : (
          <p role="alert" className="rounded-lg bg-white p-6 text-center text-neutral-700 shadow-sm">
            {loaded.kind === "missing"
              ? "Oferta não encontrada. O acesso à sua compra foi enviado para o seu e-mail."
              : "Não foi possível carregar a oferta. Tente de novo."}
          </p>
        )}
      </CheckoutShell>
    );

  const page = loaded.data.page;
  const color = page?.primaryColor ?? "#0F766E";

  if (!offer || pendingOrder)
    return (
      <CheckoutShell page={page}>
        <section className="space-y-4 rounded-lg bg-white p-5 text-center shadow-sm">
          <CheckCircle2 size={44} className="mx-auto text-emerald-600" />
          <h1 className="text-xl font-semibold text-neutral-900">
            {pendingOrder ? "Acompanhe o pagamento" : "Compra concluída"}
          </h1>
          <p className="text-sm text-neutral-600">
            {pendingOrder
              ? "Levando você ao pagamento da oferta…"
              : loaded.data.state === "CLOSED"
                ? "O prazo desta oferta terminou. O acesso à sua compra continua valendo e foi enviado para o seu e-mail."
                : "O acesso foi enviado para o seu e-mail."}
          </p>
          {loaded.data.accessUrl && !pendingOrder && (
            <a
              href={loaded.data.accessUrl}
              className="flex h-12 w-full items-center justify-center rounded-md font-semibold text-white"
              style={{ backgroundColor: color }}
            >
              Acessar minha compra
            </a>
          )}
        </section>
      </CheckoutShell>
    );

  const image = checkoutImageUrl(offer.imageUrl);
  const period = periodPriceLabel(offer.accessPeriodMonths);
  const option = quote?.options.find((item) => item.installments === installments) ?? null;
  const cardReady = chosen === "CARD" && option !== null;
  const canAccept = busy === null && (chosen === "PIX" ? pixEnabled : cardReady);
  return (
    <CheckoutShell page={page} purchase>
      <section className="space-y-4 rounded-lg bg-white p-5 shadow-sm">
        <p className="text-center text-sm font-semibold uppercase tracking-wide" style={{ color }}>
          {offer.kind === "DOWNSELL" ? "Espere! Uma última oferta" : "Oferta especial para você"}
        </p>
        {data?.expiresAt && (
          <p className="text-center text-xs text-neutral-500">
            Válida por mais <span className="font-mono font-semibold">{remaining(data.expiresAt, now)}</span>
          </p>
        )}
        {image && (
          // eslint-disable-next-line @next/next/no-img-element -- served by the API
          <img src={image} alt="" className="mx-auto max-h-56 rounded-md object-cover" />
        )}
        <h1 className="text-center text-xl font-semibold text-neutral-900">{offer.headline || offer.name}</h1>
        {offer.headline && <p className="text-center text-sm font-medium text-neutral-700">{offer.name}</p>}
        {offer.description && <p className="whitespace-pre-line text-sm text-neutral-600">{offer.description}</p>}
        <p className="text-center">
          {offer.compareAtPriceCents && (
            <span className="mr-2 text-sm text-neutral-400 line-through">{formatBRL(offer.compareAtPriceCents)}</span>
          )}
          <span className="text-2xl font-bold text-neutral-900">{formatBRL(offer.priceCents)}</span>
        </p>
        {period && <p className="text-center text-sm text-neutral-700">{period}</p>}

        {card && pixEnabled && (
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Forma de pagamento">
            {(["CARD", "PIX"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={chosen === value}
                className={`h-11 rounded-md border text-sm font-semibold ${chosen === value ? "border-transparent text-white" : "border-neutral-300 text-neutral-700"}`}
                style={chosen === value ? { backgroundColor: color } : undefined}
                onClick={() => setMethod(value)}
              >
                {value === "CARD" ? "Mesmo cartão" : "Pix"}
              </button>
            ))}
          </div>
        )}
        {chosen === "CARD" && card && (
          <div className="space-y-2">
            <p className="text-sm text-neutral-600">
              No mesmo cartão {BRAND_LABELS[card.brand] ?? ""} da sua compra, sem digitar de novo.
            </p>
            {quote ? (
              <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
                Parcelas
                <select
                  className="h-11 rounded-md border border-neutral-300 bg-white px-3 text-sm"
                  value={installments}
                  onChange={(event) => setInstallments(Number(event.target.value))}
                >
                  {quote.options.map((item) => (
                    <option key={item.installments} value={item.installments}>
                      {item.installments}x de {formatBRL(item.installmentValueCents)}
                      {item.installments > 1 ? ` (total ${formatBRL(item.totalCents)})` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="flex items-center gap-2 text-sm text-neutral-500">
                <Loader2 size={16} className="animate-spin" /> Calculando as parcelas…
              </p>
            )}
          </div>
        )}
        {chosen === "PIX" && (
          <p className="text-sm text-neutral-600">
            {pixEnabled ? "Geramos um Pix novo, com os seus dados já preenchidos." : "Pagamento indisponível no momento."}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <button
          type="button"
          className="flex h-12 w-full items-center justify-center gap-2 rounded-md font-semibold text-white disabled:opacity-60"
          style={{ backgroundColor: color }}
          disabled={!canAccept}
          onClick={() => void accept()}
        >
          {busy === "accept" && <Loader2 size={18} className="animate-spin" />}
          Sim, quero por {formatBRL(cardReady && option ? option.totalCents : offer.priceCents)}
        </button>
        <button
          type="button"
          className="w-full text-center text-sm text-neutral-500 underline disabled:opacity-60"
          disabled={busy !== null}
          onClick={() => void decline()}
        >
          Não, obrigado
        </button>
        <p className="text-center text-xs text-neutral-500">
          É uma compra separada, com reembolso em até 7 dias. O acesso à sua compra já está garantido.
        </p>
      </section>
    </CheckoutShell>
  );
}
