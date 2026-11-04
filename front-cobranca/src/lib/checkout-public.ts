// Calls of the public checkout pages (/c/...): no session, only the product
// slug or the order token. The backend decides everything; these pages show it.

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export interface PublicCheckoutProduct {
  available: boolean;
  unavailableMessage: string | null;
  product: {
    slug: string;
    name: string;
    description: string | null;
    priceCents: number;
    compareAtPriceCents: number | null;
    imageUrl: string | null;
    accessPeriodMonths: number | null;
  };
  bumps: Array<{
    id: string;
    name: string;
    headline: string | null;
    description: string | null;
    priceCents: number;
    compareAtPriceCents: number | null;
    imageUrl: string | null;
    accessPeriodMonths: number | null;
  }>;
  page: {
    displayName: string;
    logoUrl: string | null;
    bannerUrl: string | null;
    primaryColor: string;
    supportEmail: string | null;
    supportWhatsapp: string | null;
    whatsappButtonPhone: string | null;
  };
  payment: {
    pixEnabled: boolean;
    cardEnabled: boolean;
    maxInstallments: number | null;
    // The product has an offer after the purchase: the card token is reusable.
    cardReuse?: boolean;
  };
}

export interface PublicCheckoutQuote {
  items: Array<{ kind: "MAIN" | "BUMP"; name: string; unitPriceCents: number; discountCents: number }>;
  couponCode: string | null;
  discountCents: number;
  subtotalCents: number;
  surchargeCents: number;
  totalCents: number;
}

export type PublicOrderStatus = "PENDING" | "PAID" | "EXPIRED" | "FAILED" | "DECLINED" | "REFUNDED" | "CHARGEBACK";

export interface PublicCheckoutOrder {
  token: string;
  productSlug: string;
  status: PublicOrderStatus;
  paymentMethod: "PIX" | "CARD";
  installments: number | null;
  processing: boolean;
  card: { declined: boolean; canRetry: boolean } | null;
  expiresAt: string;
  items: Array<{
    kind: "MAIN" | "BUMP";
    name: string;
    unitPriceCents: number;
    discountCents: number;
    accessUrl: string | null;
    accessInstructions: string | null;
    // What this item returns if refunded alone (surcharge included).
    refundCents?: number;
  }>;
  // The refund request still open (the buyer may withdraw it) and items already refunded.
  refund?: {
    open: { itemIndexes: number[]; amountCents: number | null; holdUntil: string | null; createdAt: string } | null;
    refundedItemIndexes: number[];
  };
  subtotalCents: number;
  discountCents: number;
  surchargeCents: number;
  totalCents: number;
  pix: { copyPaste: string | null; qrCodeImage: string | null } | null;
  redirectUrl: string | null;
  // OFFER: the paid purchase goes to its one-click offer first.
  redirectKind?: "ACCESS" | "OFFER";
  // An offer order goes back to its offer page (e.g. Pix after a card decline).
  offerPage?: string | null;
  page: {
    displayName: string;
    primaryColor: string;
    logoUrl: string | null;
    supportEmail: string | null;
    supportWhatsapp: string | null;
  } | null;
}

export interface CheckoutBuyer {
  name: string;
  email: string;
  document: string;
  phone: string;
}

export type Utm = Partial<Record<"utm_source" | "utm_medium" | "utm_campaign" | "utm_term" | "utm_content", string>>;

/** A refusal the buyer can read (coupon, data, unavailable), or a generic one. */
export class CheckoutPublicError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: init.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body = (await response.json().catch(() => null)) as
    | (T & { code?: unknown; message?: unknown })
    | null;
  if (!response.ok) {
    const message = Array.isArray(body?.message) ? body.message[0] : body?.message;
    throw new CheckoutPublicError(
      typeof message === "string" && response.status < 500
        ? message
        : "Não foi possível falar com o servidor. Tente de novo.",
      response.status,
      typeof body?.code === "string" ? body.code : null,
    );
  }
  return body as T;
}

/** Image paths come from the API ("/checkout/public/assets/<id>"). */
export function checkoutImageUrl(path: string | null): string | null {
  return path ? `${API_URL}${path}` : null;
}

export function getCheckoutProduct(slug: string, signal?: AbortSignal) {
  return request<PublicCheckoutProduct>(`/checkout/public/products/${encodeURIComponent(slug)}`, { signal });
}

export function quoteCheckout(
  slug: string,
  body: { bumpIds: string[]; couponCode: string | null },
  signal?: AbortSignal,
) {
  return request<PublicCheckoutQuote>(`/checkout/public/products/${encodeURIComponent(slug)}/quote`, {
    method: "POST",
    body: JSON.stringify({ ...body, method: "PIX" }),
    signal,
  });
}

export function createCheckoutOrder(
  slug: string,
  body: {
    bumpIds: string[];
    couponCode: string | null;
    buyer: CheckoutBuyer;
    utm: Utm;
    idempotencyKey: string;
    sessionKey?: string;
  },
) {
  return request<PublicCheckoutOrder>(`/checkout/public/products/${encodeURIComponent(slug)}/orders`, {
    method: "POST",
    body: JSON.stringify({ ...body, method: "PIX" }),
  });
}

/** What the buyer typed so far; the seller may contact them if they leave. */
export function saveCheckoutLead(slug: string, body: Partial<CheckoutBuyer> & { sessionKey: string; utm: Utm }) {
  return request<{ saved: boolean }>(`/checkout/public/products/${encodeURIComponent(slug)}/lead`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type CardBrand = "visa" | "mastercard" | "amex" | "elo";

export interface CardQuote {
  quoteId: string;
  validUntil: string;
  payeeCode: string;
  environment: "production" | "sandbox";
  subtotalCents: number;
  options: Array<{ installments: number; installmentValueCents: number; totalCents: number }>;
}

export interface CardAddress {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zipcode: string;
  complement?: string;
}

/** What paying by card sends: never the card itself, only the Efí token. */
export interface CardCharge {
  quoteId: string;
  installments: number;
  paymentToken: string;
  holderDocument: string;
  address: CardAddress;
  idempotencyKey: string;
}

export function quoteCheckoutCard(
  slug: string,
  body: { bumpIds: string[]; couponCode: string | null; brand: CardBrand },
  signal?: AbortSignal,
) {
  return request<CardQuote>(`/checkout/public/products/${encodeURIComponent(slug)}/card/quote`, {
    method: "POST",
    body: JSON.stringify(body),
    signal,
  });
}

export function createCheckoutCardOrder(
  slug: string,
  body: CardCharge & {
    bumpIds: string[];
    couponCode: string | null;
    buyer: CheckoutBuyer;
    utm: Utm;
    sessionKey?: string;
  },
) {
  return request<PublicCheckoutOrder>(`/checkout/public/products/${encodeURIComponent(slug)}/card/orders`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function payCheckoutCard(token: string, body: CardCharge) {
  return request<PublicCheckoutOrder>(`/checkout/public/orders/${encodeURIComponent(token)}/card/pay`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getCheckoutOrder(token: string, signal?: AbortSignal) {
  return request<PublicCheckoutOrder>(`/checkout/public/orders/${encodeURIComponent(token)}`, { signal });
}

export type OfferKind = "UPSELL" | "DOWNSELL";

/** The one-click offer after a paid purchase; the token is the offer key. */
export interface PublicOffer {
  state: "OFFER" | "DONE" | "CLOSED";
  expiresAt: string | null;
  accessUrl: string | null;
  page: PublicCheckoutOrder["page"];
  offer: {
    id: string;
    kind: OfferKind;
    name: string;
    headline: string | null;
    description: string | null;
    priceCents: number;
    compareAtPriceCents: number | null;
    imageUrl: string | null;
    accessPeriodMonths: number | null;
  } | null;
  // An order already started for this offer: the page follows it.
  order: { token: string; status: PublicOrderStatus } | null;
  payment?: {
    pixEnabled: boolean;
    card: { brand: CardBrand; maxInstallments: number } | null;
  };
}

export interface OfferCardQuote {
  quoteId: string;
  validUntil: string;
  subtotalCents: number;
  options: CardQuote["options"];
}

export function getCheckoutOffer(token: string, offerId: string | null, signal?: AbortSignal) {
  const query = offerId ? `?oferta=${encodeURIComponent(offerId)}` : "";
  return request<PublicOffer>(`/checkout/public/offers/${encodeURIComponent(token)}${query}`, { signal });
}

export function quoteCheckoutOfferCard(token: string, offerId: string, signal?: AbortSignal) {
  return request<OfferCardQuote>(`/checkout/public/offers/${encodeURIComponent(token)}/card/quote`, {
    method: "POST",
    body: JSON.stringify({ offerId }),
    signal,
  });
}

export function acceptCheckoutOffer(
  token: string,
  body: { offerId: string; method: "PIX" | "CARD"; quoteId?: string; installments?: number; idempotencyKey: string },
) {
  return request<PublicCheckoutOrder>(`/checkout/public/offers/${encodeURIComponent(token)}/accept`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function declineCheckoutOffer(token: string, offerId: string) {
  return request<PublicOffer>(`/checkout/public/offers/${encodeURIComponent(token)}/decline`, {
    method: "POST",
    body: JSON.stringify({ offerId }),
  });
}

/** UTM parameters of the link the buyer arrived by. */
export function utmFrom(search: string): Utm {
  const params = new URLSearchParams(search);
  const utm: Utm = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const) {
    const value = params.get(key)?.trim();
    if (value) utm[key] = value.slice(0, 100);
  }
  return utm;
}

export function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100).replace(/\s/g, " ");
}

/** "12 meses de acesso", "1 ano"…, for the product period. */
export function accessPeriodLabel(months: number | null): string | null {
  if (!months) return null;
  if (months % 12 === 0) return months === 12 ? "1 ano de acesso" : `${months / 12} anos de acesso`;
  return months === 1 ? "1 mês de acesso" : `${months} meses de acesso`;
}

/** Leaves the checkout for the seller's access page (kept apart so tests can stub it). */
export function openAccess(url: string): void {
  window.location.assign(url);
}

/** The buyer's refund request from the e-mail link (7 days after payment). */
export function requestCheckoutRefund(token: string, reason: string, itemIndexes: number[] = []) {
  return request<{ id: string; status: string }>(`/checkout/public/orders/${encodeURIComponent(token)}/refund-request`, {
    method: "POST",
    body: JSON.stringify({ reason, itemIndexes }),
  });
}

/** Only the buyer gives up a refund request, with the order token of the e-mail. */
export function withdrawCheckoutRefund(token: string) {
  return request<{ id: string; status: string }>(
    `/checkout/public/orders/${encodeURIComponent(token)}/refund-request/withdraw`,
    { method: "POST" },
  );
}
