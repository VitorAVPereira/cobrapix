import { Injectable } from '@nestjs/common';
import {
  CheckoutLedgerKind,
  CheckoutOrderStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { OrderItem } from './checkout-pricing';

type Client = Prisma.TransactionClient | PrismaService;

export const RELEASE_DELAY_MS = 7 * 86_400_000;
const SOLD: CheckoutOrderStatus[] = ['PAID', 'REFUNDED', 'CHARGEBACK'];

/** The refund request still open on a sale, without its status. */
function openRequest<T extends { status: string }>(
  requests: T[],
): Omit<T, 'status'> | null {
  const open = requests.find((request) => request.status === 'REQUESTED');
  if (!open) return null;
  const rest: Partial<T> = { ...open };
  delete rest.status;
  return rest as Omit<T, 'status'>;
}

export interface LedgerEntryInput {
  companyId: string;
  orderId?: string | null;
  kind: CheckoutLedgerKind;
  amountCents: number;
  availableAt: Date;
  idempotencyKey: string;
  evidenceReference?: string | null;
  note?: string | null;
  createdByUserId?: string | null;
}

export interface SalesQuery {
  from?: Date;
  to?: Date;
  status?: CheckoutOrderStatus;
  page: number;
  pageSize: number;
}

@Injectable()
export class CheckoutLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Writes entries once: the same idempotency key never counts twice. */
  async record(client: Client, entries: LedgerEntryInput[]): Promise<void> {
    if (entries.length)
      await client.checkoutLedgerEntry.createMany({
        data: entries,
        skipDuplicates: true,
      });
  }

  /**
   * A paid order: what was received, the Efí tariff (real when the notice
   * brought it) and the Cifra+ %, all released 7 days after the payment.
   */
  async recordSale(
    client: Client,
    order: {
      id: string;
      companyId: string;
      totalCents: number;
      efiFeeCents: number;
      platformFeeCents: number;
      paidAt: Date;
    },
    providerFeeCents: number | null,
    // Card: not before the Efí credits the CifraMais account.
    releaseNotBefore?: Date,
  ): Promise<void> {
    const sevenDays = order.paidAt.getTime() + RELEASE_DELAY_MS;
    const availableAt = new Date(
      Math.max(sevenDays, releaseNotBefore?.getTime() ?? 0),
    );
    const base = { companyId: order.companyId, orderId: order.id, availableAt };
    await this.record(client, [
      {
        ...base,
        kind: 'SALE',
        amountCents: order.totalCents,
        idempotencyKey: `sale:${order.id}`,
      },
      {
        ...base,
        kind: 'EFI_FEE',
        amountCents: -(providerFeeCents ?? order.efiFeeCents),
        idempotencyKey: `efi-fee:${order.id}`,
      },
      {
        ...base,
        kind: 'PLATFORM_FEE',
        amountCents: -order.platformFeeCents,
        idempotencyKey: `platform-fee:${order.id}`,
      },
    ]);
  }

  /**
   * "Released" already discounts payouts, refunds and adjustments, so it is
   * what can still be paid out; "pending" is released later, by date.
   */
  async balance(companyId: string, now = new Date()) {
    const [released, pending, paidOut, next, openRefunds] = await Promise.all([
      this.sum({ companyId, availableAt: { lte: now } }),
      this.sum({ companyId, availableAt: { gt: now } }),
      this.sum({ companyId, kind: 'PAYOUT' }),
      this.prisma.checkoutLedgerEntry.findFirst({
        where: { companyId, availableAt: { gt: now }, amountCents: { gt: 0 } },
        orderBy: { availableAt: 'asc' },
        select: { availableAt: true },
      }),
      this.prisma.checkoutRefundRequest.findMany({
        where: { companyId, status: 'REQUESTED' },
        select: { amountCents: true, order: { select: { totalCents: true } } },
      }),
    ]);
    // A sale with a refund still open may leave the balance: not for payout.
    const onHold = openRefunds.reduce(
      (sum, open) => sum + (open.amountCents ?? open.order.totalCents),
      0,
    );
    return {
      releasedCents: released,
      suggestedPayoutCents: Math.max(0, released - onHold),
      openRefundCents: onHold,
      pendingCents: pending,
      paidOutCents: -paidOut,
      nextReleaseAt: next?.availableAt ?? null,
    };
  }

  /** Sales of one company, with their entries summed per kind. */
  async sales(companyId: string, query: SalesQuery) {
    const where: Prisma.CheckoutOrderWhereInput = {
      companyId,
      status: query.status ? query.status : { in: SOLD },
      paidAt: {
        not: null,
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lt: query.to } : {}),
      },
    };
    const [total, orders] = await Promise.all([
      this.prisma.checkoutOrder.count({ where }),
      this.prisma.checkoutOrder.findMany({
        where,
        orderBy: { paidAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          ledgerEntries: {
            select: { kind: true, amountCents: true, availableAt: true },
          },
          refundRequests: {
            where: { status: { in: ['REQUESTED', 'DONE'] } },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              origin: true,
              status: true,
              createdAt: true,
              itemIndexes: true,
              amountCents: true,
              holdUntil: true,
              buyerRemindedAt: true,
            },
          },
          offer: { select: { kind: true } },
        },
      }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      items: orders.map((order) => {
        const by = (kind: CheckoutLedgerKind) =>
          order.ledgerEntries
            .filter((entry) => entry.kind === kind)
            .reduce((sum, entry) => sum + entry.amountCents, 0);
        const sale = order.ledgerEntries.find((entry) => entry.kind === 'SALE');
        return {
          orderId: order.id,
          status: order.status,
          paidAt: order.paidAt,
          buyer: {
            name: order.buyerName,
            email: order.buyerEmail,
            phone: order.buyerPhone,
          },
          items: (order.items as unknown as OrderItem[]).map((line) => ({
            kind: line.kind,
            name: line.name,
            unitPriceCents: line.unitPriceCents,
            discountCents: line.discountCents,
          })),
          paymentMethod: order.paymentMethod,
          installments: order.installments,
          // Upsell or downsell accepted after the purchase `parentOrderId`.
          offerKind: order.offer?.kind ?? null,
          parentOrderId: order.parentOrderId,
          couponCode: order.couponCode,
          utm: order.utm,
          totalCents: order.totalCents,
          efiFeeCents: -by('EFI_FEE'),
          platformFeeCents: -(by('PLATFORM_FEE') + by('PLATFORM_FEE_REVERSAL')),
          refundedCents: -by('REFUND'),
          chargebackCents: -by('CHARGEBACK'),
          netCents: order.ledgerEntries
            .filter((entry) => entry.kind !== 'PAYOUT')
            .reduce((sum, entry) => sum + entry.amountCents, 0),
          availableAt: sale?.availableAt ?? null,
          openRefundRequest: openRequest(order.refundRequests),
          // Items already refunded cannot be asked for again.
          refundedItemIndexes: order.refundRequests.flatMap((request) =>
            request.status === 'DONE' ? request.itemIndexes : [],
          ),
        };
      }),
    };
  }

  private async sum(where: Prisma.CheckoutLedgerEntryWhereInput) {
    const result = await this.prisma.checkoutLedgerEntry.aggregate({
      where,
      _sum: { amountCents: true },
    });
    return result._sum.amountCents ?? 0;
  }
}
