import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CheckoutRefundOrigin } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ResendMailerService } from '../common/resend-mailer.service';
import { CheckoutLedgerService } from './checkout-ledger.service';

export const BUYER_REFUND_WINDOW_MS = 7 * 86_400_000;

export interface RefundInput {
  orderId: string;
  amountCents: number;
  idempotencyKey: string;
  evidenceReference?: string | null;
  note?: string | null;
  createdByUserId?: string | null;
  // A Pix refund reported by the Efí is a fact; a manual one is checked.
  fromProvider: boolean;
}

@Injectable()
export class CheckoutRefundsService {
  private readonly logger = new Logger(CheckoutRefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: CheckoutLedgerService,
    private readonly config: ConfigService,
    private readonly mailer: ResendMailerService,
  ) {}

  /**
   * Money returned to the buyer: the refund leaves the balance now and the
   * Cifra+ % comes back in proportion (the Efí keeps its tariff). Returns
   * false when this refund was already recorded.
   */
  async record(input: RefundInput, now = new Date()): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // Serialize refunds of one order so the totals below stay exact.
      await tx.$queryRaw`SELECT id FROM "CheckoutOrder" WHERE id = ${input.orderId} FOR UPDATE`;
      const order = await tx.checkoutOrder.findUnique({
        where: { id: input.orderId },
        include: {
          ledgerEntries: {
            where: { kind: { in: ['REFUND', 'PLATFORM_FEE_REVERSAL'] } },
            select: { kind: true, amountCents: true, idempotencyKey: true },
          },
        },
      });
      if (!order) throw new NotFoundException('Venda não encontrada.');
      const refundKey = `refund:${input.idempotencyKey}`;
      if (
        order.ledgerEntries.some((entry) => entry.idempotencyKey === refundKey)
      )
        return false;
      const refunded = -order.ledgerEntries
        .filter((entry) => entry.kind === 'REFUND')
        .reduce((sum, entry) => sum + entry.amountCents, 0);
      const reversed = order.ledgerEntries
        .filter((entry) => entry.kind === 'PLATFORM_FEE_REVERSAL')
        .reduce((sum, entry) => sum + entry.amountCents, 0);
      if (!input.fromProvider) {
        if (order.status !== 'PAID')
          throw this.conflict(
            'CHECKOUT_REFUND_NOT_ALLOWED',
            'Só uma venda paga pode ser reembolsada.',
          );
        if (input.amountCents > order.totalCents - refunded)
          throw this.conflict(
            'CHECKOUT_REFUND_TOO_HIGH',
            'O valor passa do que ainda pode ser devolvido nesta venda.',
          );
      }
      const refundedAfter = Math.min(
        order.totalCents,
        refunded + input.amountCents,
      );
      // Cumulative rounding: partial refunds never return more than the fee.
      const reversal =
        Math.round(
          (order.platformFeeCents * refundedAfter) / order.totalCents,
        ) - reversed;
      const common = {
        companyId: order.companyId,
        orderId: order.id,
        availableAt: now,
        evidenceReference: input.evidenceReference ?? null,
        note: input.note ?? null,
        createdByUserId: input.createdByUserId ?? null,
      };
      await this.ledger.record(tx, [
        {
          ...common,
          kind: 'REFUND',
          amountCents: -input.amountCents,
          idempotencyKey: refundKey,
        },
        ...(reversal > 0
          ? [
              {
                ...common,
                kind: 'PLATFORM_FEE_REVERSAL' as const,
                amountCents: reversal,
                idempotencyKey: `fee-reversal:${input.idempotencyKey}`,
              },
            ]
          : []),
      ]);
      if (refundedAfter >= order.totalCents && order.status === 'PAID')
        await tx.checkoutOrder.update({
          where: { id: order.id },
          data: { status: 'REFUNDED' },
        });
      await tx.checkoutRefundRequest.updateMany({
        where: { orderId: order.id, status: 'REQUESTED' },
        data: {
          status: 'DONE',
          resolvedAt: now,
          resolvedByUserId: input.createdByUserId ?? null,
        },
      });
      return true;
    });
  }

  /** The buyer asks through the e-mail link: only a paid order, within 7 days. */
  async requestByBuyer(token: string, reason: string, now = new Date()) {
    const order = await this.prisma.checkoutOrder.findUnique({
      where: { publicToken: token },
      select: { id: true, companyId: true, status: true, paidAt: true },
    });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    if (
      order.status === 'PAID' &&
      order.paidAt &&
      now.getTime() - order.paidAt.getTime() > BUYER_REFUND_WINDOW_MS
    )
      throw this.conflict(
        'CHECKOUT_REFUND_WINDOW_CLOSED',
        'O prazo de 7 dias para pedir reembolso por aqui terminou. Fale com o vendedor pelo contato do e-mail.',
      );
    return this.request(order, 'BUYER', reason);
  }

  async requestBySeller(companyId: string, orderId: string, reason: string) {
    const order = await this.prisma.checkoutOrder.findFirst({
      where: { id: orderId, companyId },
      select: { id: true, companyId: true, status: true, paidAt: true },
    });
    if (!order) throw new NotFoundException('Venda não encontrada.');
    return this.request(order, 'SELLER', reason);
  }

  async reject(
    companyId: string,
    requestId: string,
    adminUserId: string,
    note: string,
  ) {
    const updated = await this.prisma.checkoutRefundRequest.updateMany({
      where: { id: requestId, companyId, status: 'REQUESTED' },
      data: {
        status: 'REJECTED',
        resolutionNote: note.trim(),
        resolvedAt: new Date(),
        resolvedByUserId: adminUserId,
      },
    });
    if (updated.count !== 1)
      throw new NotFoundException('Pedido de reembolso não encontrado.');
  }

  private async request(
    order: { id: string; companyId: string; status: string },
    origin: CheckoutRefundOrigin,
    reason: string,
  ) {
    if (order.status !== 'PAID')
      throw this.conflict(
        'CHECKOUT_REFUND_NOT_ALLOWED',
        'Este pedido não está pago ou já foi reembolsado.',
      );
    const open = await this.prisma.checkoutRefundRequest.findFirst({
      where: { orderId: order.id, status: 'REQUESTED' },
      select: { id: true },
    });
    if (open)
      throw this.conflict(
        'CHECKOUT_REFUND_ALREADY_REQUESTED',
        'Já existe um pedido de reembolso em análise para esta compra.',
      );
    const created = await this.prisma.checkoutRefundRequest.create({
      data: {
        companyId: order.companyId,
        orderId: order.id,
        origin,
        reason: reason.trim(),
      },
      select: { id: true, status: true, createdAt: true },
    });
    await this.alertAdmin(order.companyId, origin);
    return created;
  }

  // The admin executes refunds in the Efí: a request must not go unnoticed.
  private async alertAdmin(companyId: string, origin: CheckoutRefundOrigin) {
    const to = this.config.get<string>('PLATFORM_ALERT_EMAIL');
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    const from = this.config.get<string>('RESEND_FROM_EMAIL');
    if (!to || !apiKey || !from) return;
    try {
      const company = await this.prisma.company.findUnique({
        where: { id: companyId },
        select: { corporateName: true },
      });
      const who = origin === 'BUYER' ? 'O comprador' : 'O vendedor';
      await this.mailer.sendEmail({
        apiKey,
        from,
        to: [to],
        subject: `Pedido de reembolso no checkout: ${company?.corporateName ?? 'cliente'}`,
        html: `<p>${who} pediu um reembolso em uma venda de ${company?.corporateName ?? 'um cliente de checkout'}.</p><p>Veja em Admin → Checkout.</p>`,
      });
    } catch {
      // The request is saved and listed in the admin; the e-mail is a courtesy.
      this.logger.warn('CHECKOUT_REFUND_ALERT_NOT_SENT');
    }
  }

  private conflict(code: string, message: string) {
    return new ConflictException({ code, message });
  }
}
