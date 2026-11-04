import { CheckoutDeliveryMode, CheckoutFeePayer } from '@prisma/client';
import { couponDiscountCents } from './checkout-rules';

export interface PricedProduct {
  id: string;
  name: string;
  priceCents: number;
  deliveryMode: CheckoutDeliveryMode;
  accessUrl: string | null;
  accessInstructions: string | null;
  accessPeriodMonths: number | null;
}

export interface PricedBump {
  id: string;
  priceCents: number;
  offeredProduct: PricedProduct;
}

export interface PricedCoupon {
  id: string;
  code: string;
  type: 'PERCENT' | 'FIXED';
  value: number;
  active: boolean;
  startsAt: Date | null;
  expiresAt: Date | null;
  maxUses: number | null;
  usedCount: number;
  appliesToAllProducts: boolean;
  productIds: string[];
}

/** Copied into the order: what was sold, at what price and how it is delivered. */
export interface OrderItem {
  kind: 'MAIN' | 'BUMP';
  productId: string;
  bumpId: string | null;
  name: string;
  unitPriceCents: number;
  discountCents: number;
  deliveryMode: CheckoutDeliveryMode;
  accessUrl: string | null;
  accessInstructions: string | null;
  accessPeriodMonths: number | null;
}

export interface OrderQuote {
  items: OrderItem[];
  couponId: string | null;
  couponCode: string | null;
  discountCents: number;
  subtotalCents: number;
  surchargeCents: number;
  totalCents: number;
  efiFeeBasisPoints: number;
  efiFeeCents: number;
  platformFeeBasisPoints: number;
  platformFeeCents: number;
  feePayer: CheckoutFeePayer;
}

/** Why a coupon does not apply, in words for the buyer; null when it does. */
export function couponIssue(
  coupon: PricedCoupon | null,
  productId: string,
  now: Date,
): string | null {
  if (!coupon?.active) return 'Cupom não encontrado.';
  if (coupon.startsAt && now < coupon.startsAt)
    return 'Este cupom ainda não está valendo.';
  if (coupon.expiresAt && now > coupon.expiresAt) return 'Este cupom expirou.';
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses)
    return 'Este cupom esgotou.';
  if (!coupon.appliesToAllProducts && !coupon.productIds.includes(productId))
    return 'Este cupom não vale para este produto.';
  return null;
}

function item(
  kind: OrderItem['kind'],
  product: PricedProduct,
  unitPriceCents: number,
  bumpId: string | null,
  discountCents = 0,
): OrderItem {
  return {
    kind,
    productId: product.id,
    bumpId,
    name: product.name,
    unitPriceCents,
    discountCents,
    deliveryMode: product.deliveryMode,
    accessUrl: product.accessUrl,
    accessInstructions: product.accessInstructions,
    accessPeriodMonths: product.accessPeriodMonths,
  };
}

/**
 * The Cifra+ % is on what the seller sells (after the coupon), never on the
 * surcharge. When the buyer pays the Pix tariff, the total is grossed up so
 * that, after the tariff on the total, the seller keeps the subtotal.
 */
export function quoteOrder(input: {
  product: PricedProduct;
  bumps: PricedBump[];
  coupon: PricedCoupon | null;
  feePayer: CheckoutFeePayer;
  efiFeeBasisPoints: number;
  platformFeeBasisPoints: number;
}): OrderQuote {
  const discountCents = input.coupon
    ? couponDiscountCents(input.product.priceCents, input.coupon)
    : 0;
  const items = [
    item('MAIN', input.product, input.product.priceCents, null, discountCents),
    ...input.bumps.map((bump) =>
      item('BUMP', bump.offeredProduct, bump.priceCents, bump.id),
    ),
  ];
  const subtotalCents =
    items.reduce((sum, line) => sum + line.unitPriceCents, 0) - discountCents;
  const fee = input.efiFeeBasisPoints;
  const totalCents =
    input.feePayer === 'BUYER'
      ? Math.ceil((subtotalCents * 10_000) / (10_000 - fee))
      : subtotalCents;
  return {
    items,
    couponId: input.coupon?.id ?? null,
    couponCode: input.coupon?.code ?? null,
    discountCents,
    subtotalCents,
    surchargeCents: totalCents - subtotalCents,
    totalCents,
    efiFeeBasisPoints: fee,
    efiFeeCents: Math.round((totalCents * fee) / 10_000),
    platformFeeBasisPoints: input.platformFeeBasisPoints,
    platformFeeCents: Math.round(
      (subtotalCents * input.platformFeeBasisPoints) / 10_000,
    ),
    feePayer: input.feePayer,
  };
}

/**
 * What the buyer paid for each item: the total (surcharge included) split in
 * proportion to price minus discount, by largest remainder, so the shares
 * add up to the total exactly and refunding every item returns all of it.
 */
export function itemShares(
  items: Pick<OrderItem, 'unitPriceCents' | 'discountCents'>[],
  totalCents: number,
): number[] {
  const weights = items.map((line) =>
    Math.max(0, line.unitPriceCents - line.discountCents),
  );
  const sum = weights.reduce((total, weight) => total + weight, 0);
  if (!sum) return items.map((_, index) => (index === 0 ? totalCents : 0));
  const exact = weights.map((weight) => (totalCents * weight) / sum);
  const shares = exact.map(Math.floor);
  let rest = totalCents - shares.reduce((total, share) => total + share, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) {
    if (rest <= 0) break;
    shares[index]! += 1;
    rest -= 1;
  }
  return shares;
}
