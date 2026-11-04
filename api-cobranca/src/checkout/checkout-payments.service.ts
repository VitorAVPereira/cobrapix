import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutMailJobs } from './checkout-mail.service';
import { CheckoutLedgerService } from './checkout-ledger.service';
import { CheckoutRefundsService } from './checkout-refunds.service';
import { CheckoutWebhooksService } from './checkout-webhooks.service';
import { markRecovered } from './checkout-recovery.service';
import { offerTokenHash, offerTokenOf } from './checkout-rules';

export const CHECKOUT_TXID_PREFIX = 'ckt';
// The anomaly table accepts PIX, CHARGES or CARD; checkout reasons carry a prefix.
const ANOMALY_SOURCE = 'PIX';

export interface PixPayment {
  paidAmountCents: number | null;
  endToEndId: string | null;
  providerFeeCents: number | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function amountCents(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d+\.\d{2}$/.test(value)) return null;
  const cents = Number(value.replace('.', ''));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Splits a Pix webhook body: checkout events here, everything else to billing. */
export function splitCheckoutPixEvents(payload: unknown): {
  checkout: Record<string, unknown>[];
  rest: unknown;
} {
  if (!isRecord(payload)) return { checkout: [], rest: payload };
  const isCheckout = (event: unknown): event is Record<string, unknown> =>
    isRecord(event) &&
    typeof event.txid === 'string' &&
    event.txid.startsWith(CHECKOUT_TXID_PREFIX);
  if (Array.isArray(payload.pix)) {
    const entries = payload.pix as unknown[];
    const checkout = entries.filter(isCheckout);
    const others = entries.filter((event) => !isCheckout(event));
    return {
      checkout,
      rest: others.length ? { ...payload, pix: others } : null,
    };
  }
  return isCheckout(payload)
    ? { checkout: [payload], rest: null }
    : { checkout: [], rest: payload };
}

@Injectable()
export class CheckoutPaymentsService {
  private readonly logger = new Logger(CheckoutPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: CheckoutMailJobs,
    private readonly ledger: CheckoutLedgerService,
    private readonly refunds: CheckoutRefundsService,
    private readonly webhooks: CheckoutWebhooksService,
  ) {}

  /**
   * A Pix notice for a checkout txid. Only a payment of the exact amount, to
   * the key of the account that issued it, settles the order; anything else
   * is recorded for the admin and changes nothing.
   */
  async handlePixEvent(event: Record<string, unknown>): Promise<boolean> {
    const txid = typeof event.txid === 'string' ? event.txid : '';
    const attempt = await this.prisma.checkoutPaymentAttempt.findUnique({
      where: { efiTxid: txid },
      include: { issuerIdentity: { select: { pixKey: true } } },
    });
    if (!attempt) {
      await this.anomaly('CHECKOUT_UNKNOWN_TXID', txid);
      return false;
    }
    if (
      typeof event.chave !== 'string' ||
      event.chave !== attempt.issuerIdentity.pixKey
    ) {
      await this.anomaly('CHECKOUT_RECEIVER_MISMATCH', txid, attempt.companyId);
      return false;
    }
    // A refund notice is not a second payment: only finished refunds count.
    if (Array.isArray(event.devolucoes) && event.devolucoes.length)
      return this.applyRefunds(event, attempt.orderId, txid, attempt.companyId);
    const paid = amountCents(event.valor);
    if (paid !== attempt.amountCents) {
      await this.anomaly('CHECKOUT_AMOUNT_MISMATCH', txid, attempt.companyId);
      return false;
    }
    await this.confirm(attempt.id, {
      paidAmountCents: paid,
      endToEndId:
        typeof event.endToEndId === 'string' ? event.endToEndId : null,
      providerFeeCents: isRecord(event.gnExtras)
        ? amountCents(event.gnExtras.tarifa)
        : null,
    });
    return true;
  }

  /**
   * Marks the attempt and its order paid once. A payment is a fact: it is
   * applied even if the order had expired or the creation was taken as failed.
   */
  async confirm(
    attemptId: string,
    payment: PixPayment,
    now = new Date(),
  ): Promise<boolean> {
    const orderId = await this.prisma.$transaction(async (tx) => {
      const attempt = await tx.checkoutPaymentAttempt.findUnique({
        where: { id: attemptId },
        select: { orderId: true },
      });
      if (!attempt) return null;
      const updated = await tx.checkoutPaymentAttempt.updateMany({
        where: { id: attemptId, status: { not: 'PAID' } },
        data: { status: 'PAID', ...payment },
      });
      if (updated.count !== 1) return null;
      return this.settle(tx, attempt.orderId, now, payment.providerFeeCents);
    });
    return this.afterSettle(orderId);
  }

  /**
   * A card charge the Efí reports paid. The order takes the amounts of the
   * attempt that was paid, and its sale is released at the later of 7 days
   * and the card credit date of the account version it was sold with.
   */
  async confirmCard(attemptId: string, now = new Date()): Promise<boolean> {
    const orderId = await this.prisma.$transaction(async (tx) => {
      const attempt = await tx.checkoutCardAttempt.findUnique({
        where: { id: attemptId },
        select: {
          orderId: true,
          installments: true,
          totalCents: true,
          efiFeeCents: true,
        },
      });
      if (!attempt) return null;
      const updated = await tx.checkoutCardAttempt.updateMany({
        where: { id: attemptId, status: { not: 'PAID' } },
        data: { status: 'PAID' },
      });
      if (updated.count !== 1) return null;
      const order = await tx.checkoutOrder.findUniqueOrThrow({
        where: { id: attempt.orderId },
        select: {
          subtotalCents: true,
          platformSettings: { select: { cardCreditDays: true } },
        },
      });
      const creditDays = order.platformSettings.cardCreditDays ?? 0;
      return this.settle(
        tx,
        attempt.orderId,
        now,
        null,
        {
          installments: attempt.installments,
          totalCents: attempt.totalCents,
          efiFeeCents: attempt.efiFeeCents,
          surchargeCents: attempt.totalCents - order.subtotalCents,
        },
        new Date(now.getTime() + creditDays * 86_400_000),
      );
    });
    return this.afterSettle(orderId);
  }

  /** Everything a payment does to its order, inside the payment transaction. */
  private async settle(
    tx: Prisma.TransactionClient,
    orderId: string,
    now: Date,
    providerFeeCents: number | null,
    amounts: Prisma.CheckoutOrderUpdateInput = {},
    releaseNotBefore?: Date,
  ): Promise<string> {
    const order = await tx.checkoutOrder.update({
      where: { id: orderId },
      data: { ...amounts, status: 'PAID', paidAt: now },
      select: {
        id: true,
        companyId: true,
        productId: true,
        buyerDocument: true,
        buyerEmail: true,
        couponId: true,
        totalCents: true,
        efiFeeCents: true,
        platformFeeCents: true,
        publicToken: true,
        parentOrderId: true,
        product: {
          select: { afterPurchase: true, offerWindowMinutes: true },
        },
      },
    });
    // The one-click offer window opens with the payment. An offer order does
    // not open another one: longer chains belong to the seller's page.
    if (!order.parentOrderId && order.product.afterPurchase !== 'ACCESS')
      await tx.checkoutOrder.update({
        where: { id: order.id },
        data: {
          offerTokenHash: offerTokenHash(offerTokenOf(order.publicToken)),
          offerExpiresAt: new Date(
            now.getTime() + order.product.offerWindowMinutes * 60_000,
          ),
        },
      });
    await markRecovered(tx, { ...order, paidAt: now });
    await this.ledger.recordSale(
      tx,
      { ...order, paidAt: now },
      providerFeeCents,
      releaseNotBefore,
    );
    await this.webhooks.emit(tx, order.companyId, 'order.paid', order.id);
    // Coupon limits count paid orders only.
    if (order.couponId)
      await tx.checkoutCoupon.update({
        where: { id: order.couponId },
        data: { usedCount: { increment: 1 } },
      });
    return order.id;
  }

  private async afterSettle(orderId: string | null): Promise<boolean> {
    if (!orderId) return false;
    try {
      await this.mail.accessEmail(orderId);
    } catch {
      // The payment stands; the e-mail can be queued again by support.
      this.logger.error('CHECKOUT_ACCESS_EMAIL_NOT_QUEUED');
    }
    return true;
  }

  private async applyRefunds(
    event: Record<string, unknown>,
    orderId: string,
    txid: string,
    companyId: string,
  ): Promise<boolean> {
    const endToEndId =
      typeof event.endToEndId === 'string' ? event.endToEndId : null;
    let applied = false;
    for (const refund of event.devolucoes as unknown[]) {
      if (!isRecord(refund) || refund.status !== 'DEVOLVIDO') continue;
      const value = amountCents(refund.valor);
      if (!endToEndId || typeof refund.id !== 'string' || value === null) {
        await this.anomaly('CHECKOUT_REFUND_INVALID', txid, companyId);
        continue;
      }
      applied =
        (await this.refunds.record({
          orderId,
          amountCents: value,
          idempotencyKey: `pix:${endToEndId}:${refund.id}`,
          evidenceReference: `${endToEndId}:${refund.id}`,
          fromProvider: true,
        })) || applied;
    }
    return applied;
  }

  private async anomaly(
    reasonCode: string,
    txid: string,
    companyId?: string,
  ): Promise<void> {
    const reference = txid.slice(0, 128) || 'unknown';
    try {
      await this.prisma.paymentWebhookAnomaly.upsert({
        where: {
          source_externalReference_reasonCode: {
            source: ANOMALY_SOURCE,
            externalReference: reference,
            reasonCode,
          },
        },
        create: {
          source: ANOMALY_SOURCE,
          reasonCode,
          externalReference: reference,
          companyId: companyId ?? null,
        },
        update: { occurrences: { increment: 1 }, lastSeenAt: new Date() },
      });
    } catch {
      this.logger.error('CHECKOUT_WEBHOOK_ANOMALY_NOT_RECORDED');
    }
  }
}
