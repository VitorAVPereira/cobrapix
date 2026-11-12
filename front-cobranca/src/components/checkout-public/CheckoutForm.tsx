"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, Check, ChevronDown, CreditCard, Loader2, Lock, Plus, QrCode, Tag, X } from "lucide-react";
import {
  checkoutImageUrl,
  createCheckoutCardOrder,
  createCheckoutOrder,
  payCheckoutCard,
  formatBRL,
  periodPriceLabel,
  planName,
  quoteCheckout,
  saveCheckoutLead,
  utmFrom,
  type CheckoutBuyer,
  type PublicCheckoutProduct,
  type PublicCheckoutQuote,
} from "@/lib/checkout-public";
import { validateDebtorDocument } from "@/lib/debtor-document";
import { CardPayment, type CardOption, type CardPaymentHandle } from "./CardPayment";

const CARD_DECLINED = "Pagamento não autorizado pelo banco. Confira os dados, use outro cartão ou pague com Pix.";
const CARD_GIVE_UP = "Não foi possível pagar com cartão. Pague com Pix.";

const BUYER_STORAGE_KEY = "cifra-checkout-buyer";
const inputClass =
  "h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-base text-neutral-900 sm:text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100";
// Fields stacked in one bordered box, as one group.
const groupedInputClass =
  "h-11 w-full bg-transparent px-3 text-base text-neutral-900 sm:text-sm outline-none placeholder:text-neutral-400 focus:bg-neutral-50";
const sectionTitleClass = "text-[13px] font-medium text-neutral-700";

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

type BuyerField = keyof CheckoutBuyer;

function buyerErrors(buyer: CheckoutBuyer): Partial<Record<BuyerField, string>> {
  const errors: Partial<Record<BuyerField, string>> = {};
  if (buyer.name.trim().length < 3) errors.name = "Informe seu nome completo.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email.trim())) errors.email = "Informe um e-mail válido.";
  if (!validateDebtorDocument(buyer.document).valid) errors.document = "CPF ou CNPJ inválido.";
  if (!/^\d{10,11}$/.test(buyer.phone.replace(/\D/g, ""))) errors.phone = "Informe o celular com DDD.";
  return errors;
}

function FieldError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1 text-[13px] text-red-600">
      {message}
    </p>
  );
}

// The seller's preview has no server quote: the sum of what is on the page.
function previewQuote(data: PublicCheckoutProduct, selected: string[]): PublicCheckoutQuote {
  const items = [
    { kind: "MAIN" as const, name: data.product.name, unitPriceCents: data.product.priceCents, discountCents: 0 },
    ...data.bumps
      .filter((bump) => selected.includes(bump.id))
      .map((bump) => ({ kind: "BUMP" as const, name: bump.name, unitPriceCents: bump.priceCents, discountCents: 0 })),
  ];
  const total = items.reduce((sum, line) => sum + line.unitPriceCents, 0);
  return { items, couponCode: null, discountCents: 0, subtotalCents: total, surchargeCents: 0, totalCents: total };
}

/**
 * The payment page. With `preview`, the seller's live preview: nothing is
 * quoted, saved or paid, and the card fields are only a placeholder.
 */
export function CheckoutForm({ data, preview = false }: { data: PublicCheckoutProduct; preview?: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [couponOpen, setCouponOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // A field shows its error after the buyer leaves it filled, or after "pay".
  const [touched, setTouched] = useState<Partial<Record<BuyerField, boolean>>>({});
  const [attempted, setAttempted] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [quote, setQuote] = useState<PublicCheckoutQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [buyer, setBuyer] = useState<CheckoutBuyer>(() =>
    preview ? { name: "", email: "", document: "", phone: "" } : savedBuyer(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [method, setMethod] = useState<"PIX" | "CARD">(data.payment.pixEnabled ? "PIX" : "CARD");
  const [cardOption, setCardOption] = useState<{ option: CardOption | null; subtotalCents: number | null }>({
    option: null,
    subtotalCents: null,
  });
  // A declined card order is tried again on the same order, for the same cart.
  const [cardOrder, setCardOrder] = useState<{ token: string; cartKey: string } | null>(null);
  const cardRef = useRef<CardPaymentHandle>(null);
  const requestId = useRef(0);
  const sessionKey = useRef<string | null>(null);
  const leadSent = useRef("");

  useEffect(() => {
    if (preview) return;
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
  }, [preview, data.product.slug, selected, coupon]);
  const shown = preview ? previewQuote(data, selected) : quote;

  async function applyCoupon() {
    const code = couponInput.trim();
    if (!code || preview) return;
    setCouponError(null);
    try {
      await quoteCheckout(data.product.slug, { bumpIds: selected, couponCode: code });
      setCoupon(code.toUpperCase());
      setCouponOpen(false);
    } catch (caught) {
      setCouponError(caught instanceof Error ? caught.message : "Cupom inválido.");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (preview) return;
    setAttempted(true);
    if (Object.keys(buyerErrors(buyer)).length) {
      setSubmitError(null);
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
    if (method === "CARD") {
      await payByCard(cleaned);
      return;
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

  async function payByCard(cleaned: CheckoutBuyer) {
    const cartKey = JSON.stringify({ selected, coupon });
    try {
      const charge = { ...(await cardRef.current!.prepare()), idempotencyKey: crypto.randomUUID() };
      const order =
        cardOrder?.cartKey === cartKey
          ? await payCheckoutCard(cardOrder.token, charge)
          : await createCheckoutCardOrder(data.product.slug, {
              ...charge,
              bumpIds: selected,
              couponCode: coupon,
              buyer: cleaned,
              utm: utmFrom(window.location.search),
              sessionKey: sessionKey.current ?? undefined,
            });
      if (order.status === "PAID" || order.processing) {
        router.push(`/c/pedido/${order.token}`);
        return;
      }
      if (order.card?.canRetry) {
        setCardOrder({ token: order.token, cartKey });
        setSubmitError(CARD_DECLINED);
      } else {
        setCardOrder(null);
        setSubmitError(CARD_GIVE_UP);
        if (data.payment.pixEnabled) setMethod("PIX");
      }
    } catch (caught) {
      setSubmitError(caught instanceof Error ? caught.message : "Não foi possível pagar com cartão.");
    }
    setSubmitting(false);
  }

  const set = (change: Partial<CheckoutBuyer>) => setBuyer((current) => ({ ...current, ...change }));

  // Leaving a field sends what was typed, once it has an e-mail or a mobile.
  // A failure here never blocks the purchase.
  function saveLead() {
    if (preview) return;
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
  const plan = planName(data.product.accessPeriodMonths);
  const per = periodPriceLabel(data.product.accessPeriodMonths);
  const image = checkoutImageUrl(data.product.imageUrl);
  const errors = buyerErrors(buyer);
  const errorOf = (field: BuyerField) =>
    attempted || (touched[field] && buyer[field].trim()) ? errors[field] : undefined;
  const leave = (field: BuyerField) => setTouched((current) => ({ ...current, [field]: true }));
  const methods = [
    ...(data.payment.pixEnabled ? (["PIX"] as const) : []),
    ...(data.payment.cardEnabled ? (["CARD"] as const) : []),
  ];

  return (
    <form onSubmit={submit} className="space-y-6 rounded-xl border border-neutral-200 bg-white p-5 sm:p-7" noValidate>
      <section>
        <div className="flex gap-4">
          {image && (
            // eslint-disable-next-line @next/next/no-img-element -- served by the API
            <img src={image} alt="" className="h-16 w-16 shrink-0 rounded-lg bg-neutral-50 object-cover" />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-[15px] font-semibold leading-snug text-neutral-900">{data.product.name}</h1>
            {data.product.compareAtPriceCents && (
              <p className="text-[13px] text-neutral-400 line-through">De: {formatBRL(data.product.compareAtPriceCents)}</p>
            )}
            <p className="text-sm text-neutral-900">
              {data.product.compareAtPriceCents ? "Por: " : ""}
              {formatBRL(data.product.priceCents)}
              {per && <span className="text-neutral-500"> {per}</span>}
            </p>
            {coupon ? (
              <p className="mt-2 inline-flex items-center gap-2 rounded-md bg-green-50 px-3 py-1.5 text-[13px] font-medium text-green-700">
                <Tag size={14} /> Cupom {coupon} aplicado
                <button type="button" aria-label="Remover cupom" className="text-green-700" onClick={() => setCoupon(null)}>
                  <X size={14} />
                </button>
              </p>
            ) : (
              !couponOpen && (
                <button
                  type="button"
                  className="mt-2 inline-flex items-center gap-2 rounded-md bg-neutral-100 px-3 py-1.5 text-[13px] font-medium text-neutral-800 hover:bg-neutral-200"
                  onClick={() => setCouponOpen(true)}
                >
                  Adicionar cupom <Plus size={14} />
                </button>
              )
            )}
          </div>
          {data.product.description && (
            <button
              type="button"
              aria-expanded={detailsOpen}
              className="flex h-7 shrink-0 items-center gap-1 text-[13px] font-medium text-neutral-900"
              onClick={() => setDetailsOpen((open) => !open)}
            >
              Detalhes <ChevronDown size={16} className={detailsOpen ? "rotate-180" : ""} />
            </button>
          )}
        </div>
        {detailsOpen && data.product.description && (
          <p className="mt-3 whitespace-pre-line text-sm text-neutral-600">{data.product.description}</p>
        )}
        {couponOpen && !coupon && (
          <div className="mt-3 flex gap-2">
            <input
              className={inputClass}
              aria-label="Cupom de desconto"
              placeholder="Código do cupom"
              value={couponInput}
              onChange={(event) => setCouponInput(event.target.value)}
            />
            <button
              type="button"
              className="h-11 shrink-0 rounded-lg bg-neutral-900 px-4 text-sm font-semibold text-white"
              onClick={() => void applyCoupon()}
            >
              Aplicar
            </button>
          </div>
        )}
        {couponError && <p role="alert" className="mt-1 text-sm text-red-600">{couponError}</p>}
      </section>

      <section className="space-y-2" onBlur={saveLead}>
        <h2 className={sectionTitleClass}>Informações pessoais</h2>
        <div className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <input className={groupedInputClass} aria-label="E-mail" placeholder="E-mail (o acesso chega aqui)" type="email" autoComplete="email" value={buyer.email} onChange={(event) => set({ email: event.target.value })} onBlur={() => leave("email")} />
          <div className="flex items-center">
            <span className="pl-3 text-sm text-neutral-500">+55</span>
            <input className={groupedInputClass} aria-label="Celular com DDD" placeholder="Celular com DDD" inputMode="tel" autoComplete="tel-national" value={buyer.phone} onChange={(event) => set({ phone: event.target.value })} onBlur={() => leave("phone")} />
          </div>
          <input className={groupedInputClass} aria-label="Nome completo" placeholder="Nome completo" autoComplete="name" value={buyer.name} onChange={(event) => set({ name: event.target.value })} onBlur={() => leave("name")} />
        </div>
        <FieldError message={errorOf("email") ?? errorOf("phone") ?? errorOf("name")} />
        <p className="text-xs text-neutral-500">
          O vendedor pode usar estes dados para falar com você sobre esta compra, mesmo que você não a conclua.{" "}
          <Link href="/privacidade-checkout" className="underline" target="_blank">
            Aviso de privacidade
          </Link>
        </p>
      </section>

      {plan && (
        <section className="space-y-2">
          <h2 className={sectionTitleClass}>Plano de assinatura</h2>
          <p className="flex h-11 items-center rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-900">
            {plan}
          </p>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold text-neutral-900">Método de pagamento</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Forma de pagamento">
          {methods.map((option) => (
            <label
              key={option}
              className={`flex h-[72px] cursor-pointer flex-col justify-between rounded-lg border bg-white p-3 text-[13px] font-semibold text-neutral-900 ${
                method === option ? "border-neutral-900 ring-1 ring-neutral-900" : "border-neutral-200 hover:border-neutral-300"
              }`}
            >
              <input
                type="radio"
                name="method"
                className="sr-only"
                checked={method === option}
                onChange={() => {
                  setMethod(option);
                  setSubmitError(null);
                }}
              />
              {option === "PIX" ? <QrCode size={18} /> : <CreditCard size={18} />}
              {option === "PIX" ? "Pix" : "Cartão"}
            </label>
          ))}
        </div>
        {method === "CARD" && preview && (
          <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-center text-[13px] text-neutral-500">
            Aqui o comprador preenche os dados do cartão.
          </p>
        )}
        {method === "CARD" && !preview && (
          <CardPayment
            ref={cardRef}
            slug={data.product.slug}
            cart={{ bumpIds: selected, couponCode: coupon }}
            buyerDocument={buyer.document}
            reuse={Boolean(data.payment.cardReuse)}
            onOption={(option, subtotalCents) => setCardOption({ option, subtotalCents })}
          />
        )}
      </section>

      <section className="space-y-2" onBlur={saveLead}>
        <h2 className={sectionTitleClass}>Documento</h2>
        <input className={inputClass} aria-label="CPF ou CNPJ" placeholder="CPF/CNPJ" inputMode="numeric" value={buyer.document} onChange={(event) => set({ document: event.target.value })} onBlur={() => leave("document")} />
        <FieldError message={errorOf("document")} />
      </section>

      {data.bumps.length > 0 && (
        <section className="space-y-4">
          {data.bumps.map((bump) => {
            const checked = selected.includes(bump.id);
            const bumpImage = checkoutImageUrl(bump.imageUrl);
            const bumpPeriod = periodPriceLabel(bump.accessPeriodMonths);
            return (
              <div key={bump.id} className="overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50">
                {/* Red while offered, green once in the cart, as the buyer expects from other checkouts. */}
                <div
                  className={`flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold text-white ${checked ? "bg-green-500" : "bg-red-500"}`}
                >
                  {checked ? <Check size={15} className="shrink-0" /> : <ArrowDown size={15} className="shrink-0" />}
                  {checked ? "Adicionado ao carrinho" : bump.headline || bump.name}
                </div>
                <label className="flex cursor-pointer gap-3 px-4 py-3.5">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 accent-neutral-900"
                    checked={checked}
                    onChange={() =>
                      setSelected((current) => (checked ? current.filter((id) => id !== bump.id) : [...current, bump.id]))
                    }
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-neutral-900">{bump.callToAction || `Sim, quero ${bump.name}`}</span>
                    {bump.description && <span className="mt-1 block text-[13px] text-neutral-500">{bump.description}</span>}
                  </span>
                </label>
                <div className="flex items-center gap-4 border-t border-neutral-200 px-4 py-3.5">
                  {bumpImage && (
                    // eslint-disable-next-line @next/next/no-img-element -- served by the API
                    <img src={bumpImage} alt="" className="h-12 w-12 shrink-0 rounded-md bg-white object-contain" />
                  )}
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-neutral-900">{bump.name}</p>
                    <p className="flex flex-wrap items-baseline gap-2">
                      {bump.compareAtPriceCents && (
                        <span className="text-red-500 line-through">{formatBRL(bump.compareAtPriceCents)}</span>
                      )}
                      <span className={bump.compareAtPriceCents ? "text-green-600" : "text-neutral-900"}>
                        {formatBRL(bump.priceCents)}
                      </span>
                    </p>
                    {bumpPeriod && <p className="text-[13px] text-neutral-900">{bumpPeriod}</p>}
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      )}

      <section className="border-t border-neutral-200 pt-4">
        {quoteError ? (
          <p role="alert" className="text-sm text-red-600">{quoteError}</p>
        ) : !shown ? (
          <p className="flex items-center gap-2 text-sm text-neutral-500"><Loader2 size={16} className="animate-spin" /> Calculando total…</p>
        ) : (
          <dl className="space-y-1 text-sm text-neutral-600">
            {shown.items.map((line) => (
              <div key={`${line.kind}-${line.name}`} className="flex justify-between gap-2">
                <dt>{line.name}</dt>
                <dd>{formatBRL(line.unitPriceCents)}</dd>
              </div>
            ))}
            {shown.discountCents > 0 && (
              <div className="flex justify-between text-green-700"><dt>Desconto</dt><dd>− {formatBRL(shown.discountCents)}</dd></div>
            )}
            {method === "PIX" && shown.surchargeCents > 0 && (
              <div className="flex justify-between"><dt>Taxa do Pix</dt><dd>{formatBRL(shown.surchargeCents)}</dd></div>
            )}
            {method === "CARD" && cardOption.option && cardOption.subtotalCents !== null && cardOption.option.totalCents > cardOption.subtotalCents && (
              <div className="flex justify-between">
                <dt>Acréscimo do cartão</dt>
                <dd>{formatBRL(cardOption.option.totalCents - cardOption.subtotalCents)}</dd>
              </div>
            )}
            <div className="flex justify-between pt-1 text-base font-semibold text-neutral-900">
              <dt>Total</dt>
              <dd data-testid="checkout-total">
                {formatBRL(method === "CARD" && cardOption.option ? cardOption.option.totalCents : shown.totalCents)}
              </dd>
            </div>
            {method === "CARD" && cardOption.option && cardOption.option.installments > 1 && (
              <p className="text-right text-xs text-neutral-500">
                em {cardOption.option.installments}x de {formatBRL(cardOption.option.installmentValueCents)}
              </p>
            )}
          </dl>
        )}
      </section>

      {submitError && <p role="alert" className="text-sm text-red-600">{submitError}</p>}
      <button
        type="submit"
        disabled={submitting || !shown || (method === "CARD" && !cardOption.option)}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-neutral-950 text-[15px] font-semibold text-white hover:bg-neutral-800 disabled:opacity-60"
      >
        {submitting && <Loader2 size={20} className="animate-spin" />}
        {method === "CARD" ? "Pagar com cartão" : "Gerar Pix"}
      </button>
      <p className="flex items-center justify-center gap-2 text-[13px] text-neutral-500">
        <Lock size={15} className="text-green-500" /> Transação Segura e Criptografada
      </p>
    </form>
  );
}
