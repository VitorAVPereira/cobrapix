// Card helpers of the public checkout that talk to third parties from the
// browser: the Efí library (brand and token) and the ViaCEP address lookup.
// The card data goes only to the Efí; our API receives the token.

import type { CardAddress, CardBrand } from "./checkout-public";

const BRANDS: CardBrand[] = ["visa", "mastercard", "amex", "elo"];

/** The brand the Efí library sees in the number, or null when not accepted. */
export async function detectCardBrand(cardNumber: string): Promise<CardBrand | null> {
  const digits = cardNumber.replace(/\D/g, "");
  if (digits.length < 13) return null;
  try {
    const { default: EfiPay } = await import("payment-token-efi");
    const brand = (await EfiPay.CreditCard.setCardNumber(digits).verifyCardBrand()).toLowerCase();
    return BRANDS.find((accepted) => accepted === brand) ?? null;
  } catch {
    return null;
  }
}

export interface CardData {
  brand: CardBrand;
  number: string;
  cvv: string;
  expirationMonth: string;
  expirationYear: string;
  holderName: string;
  holderDocument: string;
}

/** Card → one-time token at the Efí, for the CifraMais account. */
export async function tokenizeCard(
  account: { payeeCode: string; environment: "production" | "sandbox" },
  card: CardData,
): Promise<string> {
  const { default: EfiPay } = await import("payment-token-efi");
  const response = await EfiPay.CreditCard.setAccount(account.payeeCode)
    .setEnvironment(account.environment)
    .setCreditCardData({ ...card, number: card.number.replace(/\D/g, ""), reuse: false })
    .getPaymentToken();
  if (!("payment_token" in response)) throw new Error("Confira os dados do cartão e tente de novo.");
  return response.payment_token;
}

/** Street, district, city and state of a CEP; null when not found. */
export async function lookupCep(cep: string): Promise<Omit<CardAddress, "number" | "zipcode"> | null> {
  const digits = cep.replace(/\D/g, "");
  if (digits.length !== 8) return null;
  try {
    const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`, { credentials: "omit", cache: "force-cache" });
    if (!response.ok) return null;
    const data = (await response.json()) as Record<string, unknown>;
    if (data.erro) return null;
    const text = (value: unknown) => (typeof value === "string" ? value : "");
    return {
      street: text(data.logradouro),
      neighborhood: text(data.bairro),
      city: text(data.localidade),
      state: text(data.uf),
    };
  } catch {
    return null;
  }
}
