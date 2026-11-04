import type { CheckoutDeliveryMode } from "./api-client";

export const DELIVERY_MODE_LABELS: Record<CheckoutDeliveryMode, string> = {
  ACCESS_LINK: "Link de acesso",
  WEBHOOK: "Webhook",
  BOTH: "Link de acesso e webhook",
};

/** "2,5", "2.5" or "2,5%" in basis points (250); null when it is not a percentage. */
export function parsePercentToBps(raw: string): number | null {
  const value = raw.replace(/%|\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const bps = Math.round(Number(value) * 100);
  return bps <= 10_000 ? bps : null;
}

/** 6700 → "67,00", for a money input that shows the saved value. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

/** Public payment link of a product (opens from part 2 of the checkout). */
export function checkoutLink(slug: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/c/${slug}`;
}

/** WhatsApp on the seller's phone, with an editable opening message. */
export function recoveryWhatsAppLink(phone: string, name: string | null, productName: string): string {
  const first = name?.trim().split(/\s+/)[0];
  const greeting = first ? `Olá, ${first}!` : "Olá!";
  const text = `${greeting} Vi que você começou a compra de ${productName} e não concluiu. Posso ajudar?`;
  return `https://wa.me/55${phone}?text=${encodeURIComponent(text)}`;
}

/**
 * WhatsApp to a buyer who asked for a refund. No link: only the buyer can
 * give the refund up, from the Cifra+ e-mail.
 */
export function refundWhatsAppLink(phone: string, name: string | null, productName: string): string {
  const first = name?.trim().split(/\s+/)[0];
  const greeting = first ? `Olá, ${first}!` : "Olá!";
  const text = `${greeting} Vi que você pediu o reembolso de ${productName}. Posso ajudar em alguma coisa? Se quiser continuar com o produto, abra o e-mail da Cifra+ sobre o reembolso e toque em "Desistir do reembolso".`;
  return `https://wa.me/55${phone}?text=${encodeURIComponent(text)}`;
}
