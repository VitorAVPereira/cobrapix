"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, QrCode, Tag, X } from "lucide-react";
import {
  accessPeriodLabel,
  checkoutImageUrl,
  createCheckoutOrder,
  formatBRL,
  quoteCheckout,
  saveCheckoutLead,
  utmFrom,
  type CheckoutBuyer,
  type PublicCheckoutProduct,
  type PublicCheckoutQuote,
} from "@/lib/checkout-public";
import { validateDebtorDocument } from "@/lib/debtor-document";

const BUYER_STORAGE_KEY = "cifra-checkout-buyer";
const inputClass =
  "h-12 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200";

// Per-viewer convenience: a new Pix after an expired one keeps the data typed.
function savedBuyer(): CheckoutBuyer {
  const empty = { name: "", email: "", document: "", phone: "" };
  try {
    const raw = window.sessionStorage.getItem(BUYER_STORAGE_KEY);
    return raw ? { ...empty, ...(JSON.parse(raw) as Partial<CheckoutBuyer>) } : empty;
  } catch {
    return empty;
  }
}

function buyerProblem(buyer: CheckoutBuyer): string | null {
  if (buyer.name.trim().length < 3) return "Informe seu nome completo.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email.trim())) return "Informe um e-mail válido.";
  if (!validateDebtorDocument(buyer.document).valid) return "Confira o CPF ou CNPJ.";
  if (!/^\d{10,11}$/.test(buyer.phone.replace(/\D/g, ""))) return "Informe o celular com DDD.";
  return null;
}

function Price({ cents, compareAt }: { cents: number; compareAt: number | null }) {
  return (
    <span className="flex items-baseline gap-2">
      {compareAt && <span className="text-sm text-slate-400 line-through">{formatBRL(compareAt)}</span>}
      <span className="font-semibold text-slate-900">{formatBRL(cents)}</span>
    </span>
  );
}

export function CheckoutForm({ data }: { data: PublicCheckoutProduct }) {
  const router = useRouter();
  const color = data.page.primaryColor;
  const [selected, setSelected] = useState<string[]>([]);
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [quote, setQuote] = useState<PublicCheckoutQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [buyer, setBuyer] = useState<CheckoutBuyer>(savedBuyer);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const requestId = useRef(0);
  const sessionKey = useRef<string | null>(null);
  const leadSent = useRef("");

  useEffect(() => {
    // The total always comes from the server; an older answer is discarded.
    const controller = new AbortController();
    const current = ++requestId.current;
    quoteCheckout(data.product.slug, { bumpIds: selected, couponCode: coupon }, controller.signal)
      .then((result) => {
        if (current !== requestId.current) return;
        setQuote(result);
        setQuoteError(null);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted || current !== requestId.current) return;
        setQuoteError(caught instanceof Error ? caught.message : "Não foi possível calcular o total.");
      });
    return () => controller.abort();
  }, [data.product.slug, selected, coupon]);

  async function applyCoupon() {
    const code = couponInput.trim();
    if (!code) return;
    setCouponError(null);
    try {
      await quoteCheckout(data.product.slug, { bumpIds: selected, couponCode: code });
      setCoupon(code.toUpperCase());
    } catch (caught) {
      setCouponError(caught instanceof Error ? caught.message : "Cupom inválido.");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = buyerProblem(buyer);
    if (problem) {
      setSubmitError(problem);
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    const cleaned = {
      name: buyer.name.trim(),
      email: buyer.email.trim(),
      document: buyer.document.replace(/\D/g, ""),
      phone: buyer.phone.replace(/\D/g, ""),
    };
    try {
      window.sessionStorage.setItem(BUYER_STORAGE_KEY, JSON.stringify(cleaned));
    } catch {
      /* storage may be blocked; the order does not need it */
    }
    try {
      const order = await createCheckoutOrder(data.product.slug, {
        bumpIds: selected,
        couponCode: coupon,
        buyer: cleaned,
        utm: utmFrom(window.location.search),
        idempotencyKey: crypto.randomUUID(),
        sessionKey: sessionKey.current ?? undefined,
      });
      router.push(`/c/pedido/${order.token}`);
    } catch (caught) {
      setSubmitError(caught instanceof Error ? caught.message : "Não foi possível gerar o Pix.");
      setSubmitting(false);
    }
  }

  const set = (change: Partial<CheckoutBuyer>) => setBuyer((current) => ({ ...current, ...change }));

  // Leaving a field sends what was typed, once it has an e-mail or a mobile.
  // A failure here never blocks the purchase.
  function saveLead() {
    const lead = {
      name: buyer.name.trim(),
      email: buyer.email.trim(),
      document: buyer.document.replace(/\D/g, ""),
      phone: buyer.phone.replace(/\D/g, ""),
    };
    const usable = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email) || /^\d{10,11}$/.test(lead.phone);
    const snapshot = JSON.stringify(lead);
    if (!usable || snapshot === leadSent.current) return;
    leadSent.current = snapshot;
    sessionKey.current ??= crypto.randomUUID();
    saveCheckoutLead(data.product.slug, {
      ...lead,
      sessionKey: sessionKey.current,
      utm: utmFrom(window.location.search),
    }).catch(() => undefined);
  }
  const period = accessPeriodLabel(data.product.accessPeriodMonths);
  const image = checkoutImageUrl(data.product.imageUrl);

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <section className="flex gap-4 rounded-lg bg-white p-4 shadow-sm">
        {image && (
          // eslint-disable-next-line @next/next/no-img-element -- served by the API
          <img src={image} alt="" className="h-20 w-20 shrink-0 rounded-md object-cover" />
        )}
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-slate-900">{data.product.name}</h1>
          {period && <p className="text-sm text-slate-500">{period}</p>}
          <div className="mt-1">
            <Price cents={data.product.priceCents} compareAt={data.product.compareAtPriceCents} />
          </div>
          {data.product.description && (
            <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{data.product.description}</p>
          )}
        </div>
      </section>

      <section className="space-y-3 rounded-lg bg-white p-4 shadow-sm" onBlur={saveLead}>
        <h2 className="text-sm font-semibold text-slate-800">Seus dados</h2>
        <p className="text-xs text-slate-500">
          O vendedor pode usar estes dados para falar com você sobre esta compra, mesmo que você não a conclua.{" "}
          <Link href="/privacidade-checkout" className="underline" target="_blank">
            Aviso de privacidade
          </Link>
        </p>
        <input className={inputClass} aria-label="Nome completo" placeholder="Nome completo" autoComplete="name" value={buyer.name} onChange={(event) => set({ name: event.target.value })} />
        <input className={inputClass} aria-label="E-mail" placeholder="E-mail (o acesso chega aqui)" type="email" autoComplete="email" value={buyer.email} onChange={(event) => set({ email: event.target.value })} />
        <input className={inputClass} aria-label="CPF ou CNPJ" placeholder="CPF ou CNPJ" inputMode="numeric" value={buyer.document} onChange={(event) => set({ document: event.target.value })} />
        <input className={inputClass} aria-label="Celular com DDD" placeholder="Celular com DDD" inputMode="tel" autoComplete="tel" value={buyer.phone} onChange={(event) => set({ phone: event.target.value })} />
      </section>

      {data.bumps.length > 0 && (
        <section className="space-y-3">
          {data.bumps.map((bump) => {
            const checked = selected.includes(bump.id);
            const bumpImage = checkoutImageUrl(bump.imageUrl);
            return (
              <label key={bump.id} className="block overflow-hidden rounded-lg border-2 bg-white shadow-sm" style={{ borderColor: checked ? color : "#e2e8f0" }}>
                <div className="px-4 py-2 text-sm font-semibold uppercase text-white" style={{ backgroundColor: color }}>
                  {bump.headline || bump.name}
                </div>
                <div className="flex gap-3 p-4">
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5 shrink-0"
                    checked={checked}
                    onChange={() =>
                      setSelected((current) => (checked ? current.filter((id) => id !== bump.id) : [...current, bump.id]))
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">Sim, quero {bump.name}</p>
                    {bump.description && <p className="mt-1 text-sm text-slate-600">{bump.description}</p>}
                    <div className="mt-2">
                      <Price cents={bump.priceCents} compareAt={bump.compareAtPriceCents} />
                    </div>
                  </div>
                  {bumpImage && (
                    // eslint-disable-next-line @next/next/no-img-element -- served by the API
                    <img src={bumpImage} alt="" className="h-16 w-16 shrink-0 rounded-md object-cover" />
                  )}
                </div>
              </label>
            );
          })}
        </section>
      )}

      <section className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
        {coupon ? (
          <p className="flex items-center gap-2 text-sm text-emerald-700">
            <Tag size={16} /> Cupom {coupon} aplicado
            <button type="button" aria-label="Remover cupom" className="ml-auto text-slate-500" onClick={() => setCoupon(null)}>
              <X size={16} />
            </button>
          </p>
        ) : (
          <div className="flex gap-2">
            <input className={inputClass} aria-label="Cupom de desconto" placeholder="Cupom de desconto" value={couponInput} onChange={(event) => setCouponInput(event.target.value)} />
            <button type="button" className="h-12 shrink-0 rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700" onClick={() => void applyCoupon()}>
              Aplicar
            </button>
          </div>
        )}
        {couponError && <p role="alert" className="text-sm text-red-600">{couponError}</p>}

        {quoteError ? (
          <p role="alert" className="text-sm text-red-600">{quoteError}</p>
        ) : !quote ? (
          <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Calculando total…</p>
        ) : (
          <dl className="space-y-1 text-sm text-slate-600">
            {quote.items.map((line) => (
              <div key={`${line.kind}-${line.name}`} className="flex justify-between gap-2">
                <dt>{line.name}</dt>
                <dd>{formatBRL(line.unitPriceCents)}</dd>
              </div>
            ))}
            {quote.discountCents > 0 && (
              <div className="flex justify-between text-emerald-700"><dt>Desconto</dt><dd>− {formatBRL(quote.discountCents)}</dd></div>
            )}
            {quote.surchargeCents > 0 && (
              <div className="flex justify-between"><dt>Taxa do Pix</dt><dd>{formatBRL(quote.surchargeCents)}</dd></div>
            )}
            <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-semibold text-slate-900">
              <dt>Total</dt>
              <dd data-testid="checkout-total">{formatBRL(quote.totalCents)}</dd>
            </div>
          </dl>
        )}
      </section>

      {submitError && <p role="alert" className="text-sm text-red-600">{submitError}</p>}
      <button
        type="submit"
        disabled={submitting || !quote}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-md text-base font-semibold text-white disabled:opacity-60"
        style={{ backgroundColor: color }}
      >
        {submitting ? <Loader2 size={20} className="animate-spin" /> : <QrCode size={20} />}
        Gerar Pix
      </button>
    </form>
  );
}
