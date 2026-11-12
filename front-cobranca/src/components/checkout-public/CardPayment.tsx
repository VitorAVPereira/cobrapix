"use client";

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Ref } from "react";
import { Loader2 } from "lucide-react";
import { formatBRL, quoteCheckoutCard, type CardBrand, type CardCharge, type CardQuote } from "@/lib/checkout-public";
import { detectCardBrand, lookupCep, tokenizeCard } from "@/lib/checkout-card";
import { validateDebtorDocument } from "@/lib/debtor-document";

const inputClass =
  "h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-base text-neutral-900 sm:text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100";
const BRAND_LABELS: Record<CardBrand, string> = { visa: "Visa", mastercard: "Mastercard", amex: "Amex", elo: "Elo" };

export type CardOption = CardQuote["options"][number];

/** What the form asks before paying: the charge, or an error for the buyer. */
export interface CardPaymentHandle {
  prepare(): Promise<Omit<CardCharge, "idempotencyKey">>;
}

const EMPTY = {
  number: "",
  holderName: "",
  expiry: "",
  cvv: "",
  holderDocument: "",
  zipcode: "",
  street: "",
  addressNumber: "",
  complement: "",
  neighborhood: "",
  city: "",
  state: "",
};

function expiryParts(value: string): { month: string; year: string } | null {
  const match = /^(\d{2})\s*\/\s*(\d{2}|\d{4})$/.exec(value.trim());
  if (!match) return null;
  const month = Number(match[1]);
  const year = Number(match[2]!.length === 2 ? `20${match[2]}` : match[2]);
  const now = new Date();
  if (month < 1 || month > 12 || year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1))
    return null;
  return { month: match[1]!, year: String(year) };
}

/**
 * Card fields of the payment page. The card number, CVV and validity go
 * only to the Efí library in the browser and are cleared after the token.
 */
export function CardPayment({
  slug,
  cart,
  buyerDocument,
  reuse = false,
  onOption,
  ref,
}: {
  slug: string;
  cart: { bumpIds: string[]; couponCode: string | null };
  buyerDocument: string;
  // The product offers something after the purchase, charged on this card.
  reuse?: boolean;
  onOption: (option: CardOption | null, subtotalCents: number | null) => void;
  ref: Ref<CardPaymentHandle>;
}) {
  const [fields, setFields] = useState(EMPTY);
  const [brand, setBrand] = useState<CardBrand | null>(null);
  const [brandError, setBrandError] = useState<string | null>(null);
  const [quote, setQuote] = useState<CardQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [installments, setInstallments] = useState(1);
  const requestId = useRef(0);
  const cartKey = JSON.stringify(cart);
  const set = (change: Partial<typeof EMPTY>) => setFields((current) => ({ ...current, ...change }));

  useEffect(() => {
    if (!brand) return;
    // The installments always come from the server; an older answer is discarded.
    const controller = new AbortController();
    const current = ++requestId.current;
    quoteCheckoutCard(slug, { ...(JSON.parse(cartKey) as typeof cart), brand }, controller.signal)
      .then((result) => {
        if (current !== requestId.current) return;
        setQuote(result);
        setQuoteError(null);
        const first = result.options[0] ?? null;
        setInstallments(first?.installments ?? 1);
        onOption(first, result.subtotalCents);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted || current !== requestId.current) return;
        setQuote(null);
        onOption(null, null);
        setQuoteError(caught instanceof Error ? caught.message : "Não foi possível calcular as parcelas.");
      });
    return () => controller.abort();
    // onOption is a parent callback; the quote depends on the cart and brand only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, cartKey, brand]);

  async function checkBrand() {
    if (fields.number.replace(/\D/g, "").length < 13) return;
    const found = await detectCardBrand(fields.number);
    setBrandError(found ? null : "Aceitamos Visa, Mastercard, Elo e Amex.");
    if (found !== brand) {
      setQuote(null);
      onOption(null, null);
      setBrand(found);
    }
  }

  async function fillAddress() {
    const found = await lookupCep(fields.zipcode);
    if (found) set({ street: found.street, neighborhood: found.neighborhood, city: found.city, state: found.state });
  }

  function chooseInstallments(count: number) {
    setInstallments(count);
    onOption(quote?.options.find((option) => option.installments === count) ?? null, quote?.subtotalCents ?? null);
  }

  useImperativeHandle(ref, () => ({
    async prepare() {
      const expiry = expiryParts(fields.expiry);
      const holder = fields.holderDocument.replace(/\D/g, "") || buyerDocument.replace(/\D/g, "");
      if (!brand) throw new Error(brandError ?? "Confira o número do cartão.");
      if (fields.holderName.trim().length < 3) throw new Error("Informe o nome impresso no cartão.");
      if (!expiry) throw new Error("Confira a validade do cartão (MM/AA).");
      if (!/^\d{3,4}$/.test(fields.cvv)) throw new Error("Confira o código de segurança do cartão.");
      if (holder.length !== 11 || !validateDebtorDocument(holder).valid) throw new Error("Informe o CPF do titular do cartão.");
      if (fields.zipcode.replace(/\D/g, "").length !== 8) throw new Error("Informe o CEP do endereço de cobrança.");
      if (!fields.street.trim() || !fields.addressNumber.trim() || !fields.neighborhood.trim() || !fields.city.trim() || !/^[A-Za-z]{2}$/.test(fields.state.trim()))
        throw new Error("Confira o endereço de cobrança.");
      if (!quote || new Date(quote.validUntil).getTime() <= Date.now())
        throw new Error("Os valores foram atualizados. Confira as parcelas de novo.");
      const paymentToken = await tokenizeCard(quote, {
        brand,
        number: fields.number,
        cvv: fields.cvv,
        expirationMonth: expiry.month,
        expirationYear: expiry.year,
        holderName: fields.holderName.trim(),
        holderDocument: holder,
      }, reuse);
      // The card leaves the page as soon as the Efí gave the token.
      set({ number: "", cvv: "", expiry: "" });
      setBrand(null);
      return {
        quoteId: quote.quoteId,
        installments,
        paymentToken,
        holderDocument: holder,
        address: {
          street: fields.street.trim(),
          number: fields.addressNumber.trim(),
          neighborhood: fields.neighborhood.trim(),
          city: fields.city.trim(),
          state: fields.state.trim().toUpperCase(),
          zipcode: fields.zipcode.replace(/\D/g, ""),
          ...(fields.complement.trim() ? { complement: fields.complement.trim() } : {}),
        },
      };
    },
  }));

  return (
    <div className="space-y-3">
      <input className={inputClass} aria-label="Número do cartão" placeholder="Número do cartão" inputMode="numeric" autoComplete="cc-number" value={fields.number} onChange={(event) => set({ number: event.target.value })} onBlur={() => void checkBrand()} />
      {brand && <p className="text-xs text-neutral-500">Bandeira: {BRAND_LABELS[brand]}</p>}
      {brandError && <p role="alert" className="text-sm text-red-600">{brandError}</p>}
      <input className={inputClass} aria-label="Nome impresso no cartão" placeholder="Nome impresso no cartão" autoComplete="cc-name" value={fields.holderName} onChange={(event) => set({ holderName: event.target.value })} />
      <div className="grid grid-cols-2 gap-3">
        <input className={inputClass} aria-label="Validade (MM/AA)" placeholder="Validade (MM/AA)" inputMode="numeric" autoComplete="cc-exp" value={fields.expiry} onChange={(event) => set({ expiry: event.target.value })} />
        <input className={inputClass} aria-label="Código de segurança" placeholder="CVV" inputMode="numeric" autoComplete="cc-csc" value={fields.cvv} onChange={(event) => set({ cvv: event.target.value })} />
      </div>
      <input className={inputClass} aria-label="CPF do titular do cartão" placeholder="CPF do titular (se for outro)" inputMode="numeric" value={fields.holderDocument} onChange={(event) => set({ holderDocument: event.target.value })} />

      <h3 className="pt-2 text-sm font-semibold text-neutral-800">Endereço de cobrança</h3>
      <div className="grid grid-cols-2 gap-3">
        <input className={inputClass} aria-label="CEP" placeholder="CEP" inputMode="numeric" autoComplete="postal-code" value={fields.zipcode} onChange={(event) => set({ zipcode: event.target.value })} onBlur={() => void fillAddress()} />
        <input className={inputClass} aria-label="Número do endereço" placeholder="Número" value={fields.addressNumber} onChange={(event) => set({ addressNumber: event.target.value })} />
      </div>
      <input className={inputClass} aria-label="Rua" placeholder="Rua" autoComplete="address-line1" value={fields.street} onChange={(event) => set({ street: event.target.value })} />
      <input className={inputClass} aria-label="Complemento" placeholder="Complemento (opcional)" value={fields.complement} onChange={(event) => set({ complement: event.target.value })} />
      <div className="grid grid-cols-[1fr_1fr_5rem] gap-3">
        <input className={inputClass} aria-label="Bairro" placeholder="Bairro" value={fields.neighborhood} onChange={(event) => set({ neighborhood: event.target.value })} />
        <input className={inputClass} aria-label="Cidade" placeholder="Cidade" autoComplete="address-level2" value={fields.city} onChange={(event) => set({ city: event.target.value })} />
        <input className={inputClass} aria-label="UF" placeholder="UF" maxLength={2} autoComplete="address-level1" value={fields.state} onChange={(event) => set({ state: event.target.value })} />
      </div>

      {quoteError ? (
        <p role="alert" className="text-sm text-red-600">{quoteError}</p>
      ) : brand && !quote ? (
        <p className="flex items-center gap-2 text-sm text-neutral-500"><Loader2 size={16} className="animate-spin" /> Calculando parcelas…</p>
      ) : quote ? (
        <select aria-label="Parcelas" className={inputClass} value={installments} onChange={(event) => chooseInstallments(Number(event.target.value))}>
          {quote.options.map((option) => (
            <option key={option.installments} value={option.installments}>
              {option.installments}x de {formatBRL(option.installmentValueCents)} ({formatBRL(option.totalCents)})
            </option>
          ))}
        </select>
      ) : (
        <p className="text-xs text-neutral-500">Digite o número do cartão para ver as parcelas.</p>
      )}
    </div>
  );
}
