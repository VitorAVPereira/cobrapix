import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutLedgerService } from './checkout-ledger.service';
import { CheckoutRefundsService } from './checkout-refunds.service';
import {
  AdjustmentDto,
  OrderMoneyDto,
  PayoutDto,
} from './dto/checkout-finance.dto';

const AUDIT_RETENTION_MS = 5 * 365.25 * 86_400_000;
const INDEX_WINDOW_MS = 90 * 86_400_000;

/** Admin side of the seller's money: payouts, refunds, chargebacks, adjustments. */
@Injectable()
export class CheckoutFinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: CheckoutLedgerService,
    private readonly refunds: CheckoutRefundsService,
  ) {}

  async overview(companyId: string, now = new Date()) {
    await this.assertCheckout(companyId);
    const [balance, refundRequests, payouts, index, sales] = await Promise.all([
      this.ledger.balance(companyId, now),
      this.prisma.checkoutRefundRequest.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          order: {
            select: {
              id: true,
              buyerName: true,
              buyerEmail: true,
              totalCents: true,
              paidAt: true,
              status: true,
            },
          },
        },
      }),
      this.prisma.checkoutLedgerEntry.findMany({
        where: {
          companyId,
          kind: { in: ['PAYOUT', 'ADJUSTMENT', 'CHARGEBACK'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          kind: true,
          amountCents: true,
          orderId: true,
          evidenceReference: true,
          note: true,
          createdAt: true,
        },
      }),
      this.chargebackIndex(companyId, now),
      this.ledger.sales(companyId, { page: 1, pageSize: 50 }),
    ]);
    return {
      balance,
      refundRequests,
      entries: payouts,
      chargebackIndex: index,
      sales,
    };
  }

  /**
   * Chargebacks over sales in the last 90 days. Card brands look at card
   * sales; while the checkout sells only Pix, the base is every sale (and
   * the index is 0, since a Pix has no chargeback).
   */
  async chargebackIndex(companyId: string, now = new Date()) {
    const since = new Date(now.getTime() - INDEX_WINDOW_MS);
    const [sales, chargebacks] = await Promise.all([
      this.prisma.checkoutLedgerEntry.aggregate({
        where: { companyId, kind: 'SALE', createdAt: { gte: since } },
        _sum: { amountCents: true },
        _count: true,
      }),
      this.prisma.checkoutLedgerEntry.aggregate({
        where: { companyId, kind: 'CHARGEBACK', createdAt: { gte: since } },
        _sum: { amountCents: true },
        _count: true,
      }),
    ]);
    const salesCents = sales._sum.amountCents ?? 0;
    const chargebackCents = -(chargebacks._sum.amountCents ?? 0);
    return {
      windowDays: 90,
      salesCount: sales._count,
      salesCents,
      chargebackCount: chargebacks._count,
      chargebackCents,
      // Basis points of the sales amount.
      ratioBasisPoints: salesCents
        ? Math.round((chargebackCents * 10_000) / salesCents)
        : 0,
    };
  }

  /** A Pix the admin sent from the CifraMais account, outside the system. */
  async payout(
    companyId: string,
    adminUserId: string,
    dto: PayoutDto,
    now = new Date(),
  ) {
    await this.assertCheckout(companyId);
    const { releasedCents } = await this.ledger.balance(companyId, now);
    await this.write(companyId, adminUserId, 'CHECKOUT_PAYOUT_RECORDED', {
      kind: 'PAYOUT',
      amountCents: -dto.amountCents,
      idempotencyKey: `payout:${dto.idempotencyKey}`,
      evidenceReference: dto.reference ?? null,
      note: [`Pago em ${dto.paidOn.slice(0, 10)}`, dto.note]
        .filter(Boolean)
        .join(' · '),
    });
    return {
      // More than released is allowed (the admin manages reserves by hand),
      // but never silently.
      warning:
        dto.amountCents > releasedCents
          ? 'O repasse passou do saldo liberado. O saldo do vendedor ficou negativo.'
          : null,
      balance: await this.ledger.balance(companyId, now),
    };
  }

  async chargeback(companyId: string, adminUserId: string, dto: OrderMoneyDto) {
    await this.assertOrder(companyId, dto.orderId);
    await this.prisma.$transaction(async (tx) => {
      await this.write(
        companyId,
        adminUserId,
        'CHECKOUT_CHARGEBACK_RECORDED',
        {
          kind: 'CHARGEBACK',
          orderId: dto.orderId,
          amountCents: -dto.amountCents,
          idempotencyKey: `chargeback:${dto.idempotencyKey}`,
          evidenceReference: dto.reference ?? null,
          note: dto.note ?? null,
        },
        tx,
      );
      await tx.checkoutOrder.updateMany({
        where: {
          id: dto.orderId,
          companyId,
          status: { in: ['PAID', 'REFUNDED'] },
        },
        data: { status: 'CHARGEBACK' },
      });
    });
    return this.ledger.balance(companyId);
  }

  async adjustment(companyId: string, adminUserId: string, dto: AdjustmentDto) {
    await this.assertCheckout(companyId);
    if (dto.orderId) await this.assertOrder(companyId, dto.orderId);
    await this.write(companyId, adminUserId, 'CHECKOUT_ADJUSTMENT_RECORDED', {
      kind: 'ADJUSTMENT',
      orderId: dto.orderId ?? null,
      amountCents: dto.amountCents,
      idempotencyKey: `adjustment:${dto.idempotencyKey}`,
      evidenceReference: dto.reference ?? null,
      note: dto.note.trim(),
    });
    return this.ledger.balance(companyId);
  }

  /** A refund that did not go through the Efí notice (e.g. another Pix). */
  async manualRefund(
    companyId: string,
    adminUserId: string,
    dto: OrderMoneyDto,
  ) {
    await this.assertOrder(companyId, dto.orderId);
    await this.refunds.record({
      orderId: dto.orderId,
      amountCents: dto.amountCents,
      idempotencyKey: `manual:${dto.idempotencyKey}`,
      evidenceReference: dto.reference ?? null,
      note: dto.note ?? null,
      createdByUserId: adminUserId,
      fromProvider: false,
    });
    await this.audit(
      companyId,
      adminUserId,
      'CHECKOUT_REFUND_RECORDED',
      dto.orderId,
      {
        amountCents: dto.amountCents,
      },
    );
    return this.ledger.balance(companyId);
  }

  private async write(
    companyId: string,
    adminUserId: string,
    action: string,
    entry: {
      kind: 'PAYOUT' | 'CHARGEBACK' | 'ADJUSTMENT';
      orderId?: string | null;
      amountCents: number;
      idempotencyKey: string;
      evidenceReference: string | null;
      note: string | null;
    },
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const now = new Date();
    await this.ledger.record(client, [
      { ...entry, companyId, availableAt: now, createdByUserId: adminUserId },
    ]);
    await this.audit(
      companyId,
      adminUserId,
      action,
      entry.orderId ?? companyId,
      {
        amountCents: entry.amountCents,
        idempotencyKey: entry.idempotencyKey,
      },
      client,
    );
  }

  private audit(
    companyId: string,
    userId: string,
    action: string,
    entityId: string,
    changes: Prisma.InputJsonValue,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return client.auditLog.create({
      data: {
        companyId,
        userId,
        action,
        entityType: 'CheckoutLedgerEntry',
        entityId,
        changes,
        retentionExpiresAt: new Date(Date.now() + AUDIT_RETENTION_MS),
      },
    });
  }

  private async assertCheckout(companyId: string) {
    const found = await this.prisma.company.count({
      where: { id: companyId, product: 'CHECKOUT' },
    });
    if (!found)
      throw new NotFoundException('Cliente de checkout não encontrado.');
  }

  private async assertOrder(companyId: string, orderId: string) {
    const found = await this.prisma.checkoutOrder.count({
      where: { id: orderId, companyId, company: { product: 'CHECKOUT' } },
    });
    if (!found) throw new NotFoundException('Venda não encontrada.');
  }
}
