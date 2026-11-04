import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutMailJobs } from './checkout-mail.service';

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
    // Refunds are handled in a later part; until then the admin sees them.
    if (Array.isArray(event.devolucoes) && event.devolucoes.length) {
      await this.anomaly('CHECKOUT_REFUND_PENDING', txid, attempt.companyId);
      return false;
    }
    if (
      typeof event.chave !== 'string' ||
      event.chave !== attempt.issuerIdentity.pixKey
    ) {
      await this.anomaly('CHECKOUT_RECEIVER_MISMATCH', txid, attempt.companyId);
      return false;
    }
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
      const order = await tx.checkoutOrder.update({
        where: { id: attempt.orderId },
        data: { status: 'PAID', paidAt: now },
        select: { id: true, couponId: true },
      });
      // Coupon limits count paid orders only.
      if (order.couponId)
        await tx.checkoutCoupon.update({
          where: { id: order.couponId },
          data: { usedCount: { increment: 1 } },
        });
      return order.id;
    });
    if (!orderId) return false;
    try {
      await this.mail.accessEmail(orderId);
    } catch {
      // The payment stands; the e-mail can be queued again by support.
      this.logger.error('CHECKOUT_ACCESS_EMAIL_NOT_QUEUED');
    }
    return true;
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
