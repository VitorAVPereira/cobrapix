import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { validateDebtorDocument } from '../common/debtor-document';
import { normalizePixKey } from '../disbursements/disbursement-recipient-rules';

// Below this the card and Pix tariffs eat the sale; also the coupon floor.
export const MIN_PRICE_CENTS = 500;

export function conflict(code: string, message: string): never {
  throw new ConflictException({ code, message });
}

export function versionChanged(): never {
  conflict(
    'VERSION_CHANGED',
    'Outra pessoa alterou este registro. Recarregue e tente de novo.',
  );
}

export function invalid(message: string): BadRequestException {
  return new BadRequestException({ code: 'CHECKOUT_INVALID', message });
}

/** Price at or above the floor; the "from" price, when shown, must be higher. */
export function assertPrices(
  priceCents: number,
  compareAtPriceCents: number | null | undefined,
): void {
  if (priceCents < MIN_PRICE_CENTS) throw invalid('O preço mínimo é R$ 5,00.');
  if (compareAtPriceCents != null && compareAtPriceCents <= priceCents)
    throw invalid('O preço "De" precisa ser maior que o preço de venda.');
}

/** Access links and offer pages receive the buyer by redirect: https only. */
export function normalizeAccessUrl(
  value: string | null | undefined,
  what: 'acesso' | 'página' = 'acesso',
) {
  const text = value?.trim();
  if (!text) return null;
  const label = what === 'acesso' ? 'O link de acesso' : 'O endereço da página';
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw invalid(
      what === 'acesso'
        ? 'Informe um link de acesso válido.'
        : 'Informe um endereço de página válido.',
    );
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw invalid(`${label} precisa começar com https://.`);
  return url.toString();
}

/** CPF or CNPJ, digits only, or null when the check digits do not match. */
export function normalizeDocument(value: string): string | null {
  const document = validateDebtorDocument(value);
  return document.valid ? document.normalized : null;
}

/** Pix key in DICT format (phone with +55), or null when invalid. */
export function normalizePayoutPixKey(value: string): string | null {
  return normalizePixKey(value)?.value ?? null;
}

/** Keeps only the last digits, so audit records never hold a full document. */
export function maskDocument(document: string): string {
  return `•••${document.slice(-4)}`;
}

/**
 * The one-click offer key of a paid purchase. It comes one-way from the order
 * token, so the seller's page can hold it without seeing the order (refund,
 * access); only its hash is stored.
 */
export function offerTokenOf(publicToken: string): string {
  return createHash('sha256')
    .update(`cifra-offer:${publicToken}`)
    .digest('base64url');
}

export function offerTokenHash(offerToken: string): string {
  return createHash('sha256').update(offerToken).digest('hex');
}

export function addMonths(date: Date, months: number): Date {
  const copy = new Date(date);
  copy.setUTCMonth(copy.getUTCMonth() + months);
  return copy;
}

/** "Porquim Anual!"→ "porquim-anual-7k2m". The suffix keeps names reusable. */
export function productSlug(name: string, suffix = randomSuffix()): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return base ? `${base}-${suffix}` : suffix;
}

function randomSuffix(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(randomBytes(4), (byte) => alphabet[byte % 32]).join('');
}

/**
 * Discount of a coupon on the main product. The price never goes below the
 * floor, whatever the coupon says.
 */
export function couponDiscountCents(
  priceCents: number,
  coupon: { type: 'PERCENT' | 'FIXED'; value: number },
): number {
  const wanted =
    coupon.type === 'PERCENT'
      ? Math.floor((priceCents * coupon.value) / 10_000)
      : coupon.value;
  return Math.max(0, Math.min(wanted, priceCents - MIN_PRICE_CENTS));
}
