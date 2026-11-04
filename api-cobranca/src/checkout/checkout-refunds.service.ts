import {
  BadRequestException,
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
import { CheckoutWebhooksService } from './checkout-webhooks.service';
import { CheckoutMailJobs } from './checkout-mail.service';
import { itemShares, type OrderItem } from './checkout-pricing';

export const BUYER_REFUND_WINDOW_MS = 7 * 86_400_000;
// The seller has 7 days to win back a buyer who asked for a refund.
export const REFUND_HOLD_MS = 7 * 86_400_000;
export const REMIND_EVERY_MS = 86_400_000;

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

/** Item names of an order, for notices; empty indexes mean the whole order. */
function itemNames(items: OrderItem[], indexes: number[]): string[] {
  return (indexes.length ? indexes : items.map((_, index) => index))
    .map((index) => items[index]?.name)
    .filter((name): name is string => Boolean(name));
}

@Injectable()
export class CheckoutRefundsService {
  private readonly logger = new Logger(CheckoutRefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: CheckoutLedgerService,
    private readonly config: ConfigService,
    private readonly mailer: ResendMailerService,
    private readonly webhooks: CheckoutWebhooksService,
    private readonly mail: CheckoutMailJobs,
  ) {}

  /**
   * Money returned to the buyer: the refund leaves the balance now and the
   * Cifra+ % comes back in proportion (the Efí keeps its tariff). Returns
   * false when this refund was already recorded.
   */
  async record(input: RefundInput, now = new Date()): Promise<boolean> {
    const applied = await this.prisma.$transaction(async (tx) => {
      // Serialize refunds of one order so the totals below stay exact.
      await tx.$queryRaw`SELECT id FROM "CheckoutOrder" WHERE id = ${input.orderId} FOR UPDATE`;
      const order = await tx.checkoutOrder.findUnique({
        where: { id: input.orderId },
        include: {
          ledgerEntries: {
            where: { kind: { in: ['REFUND', 'PLATFORM_FEE_REVERSAL'] } },
            select: { kind: true, amountCents: true, idempotencyKey: true },
          },
          refundRequests: { where: { status: 'REQUESTED' } },
        },
      });
      if (!order) throw new NotFoundException('Venda não encontrada.');
      const refundKey = `refund:${input.idempotencyKey}`;
      if (
        order.ledgerEntries.some((entry) => entry.idempotencyKey === refundKey)
      )
        return null;
      const open = order.refundRequests[0] ?? null;
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
        // The seller's 7 days are not cut short by hand; a Pix the Efí
        // already returned (fromProvider) is a fact and always counts.
        if (open?.holdUntil && now < open.holdUntil)
          throw this.conflict(
            'CHECKOUT_REFUND_ON_HOLD',
            'Este pedido de reembolso está no prazo do vendedor. Execute depois da data de retenção.',
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
      // The amount says which request this refund pays: then its items are known.
      const items =
        open && open.amountCents === input.amountCents
          ? open.itemIndexes
          : null;
      // The seller system takes the access away (or part of it) from here.
      await this.webhooks.emit(
        tx,
        order.companyId,
        'order.refunded',
        order.id,
        {
          refund: {
            amountCents: input.amountCents,
            totalRefundedCents: refundedAfter,
            items: items
              ? itemNames(order.items as unknown as OrderItem[], items)
              : null,
          },
        },
      );
      return { orderId: order.id };
    });
    if (!applied) return false;
    await this.queueMail(() =>
      this.mail.refundEmail('DONE', applied.orderId, input.idempotencyKey, {
        amountCents: input.amountCents,
      }),
    );
    return true;
  }

  /** The buyer asks through the e-mail link: only a paid order, within 7 days. */
  async requestByBuyer(
    token: string,
    reason: string,
    itemIndexes: number[] = [],
    now = new Date(),
  ) {
    const order = await this.prisma.checkoutOrder.findUnique({
      where: { publicToken: token },
      select: { id: true, paidAt: true, status: true },
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
    return this.request(order.id, 'BUYER', reason, itemIndexes, now);
  }

  async requestBySeller(
    companyId: string,
    orderId: string,
    reason: string,
    itemIndexes: number[] = [],
    now = new Date(),
  ) {
    const order = await this.prisma.checkoutOrder.findFirst({
      where: { id: orderId, companyId },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('Venda não encontrada.');
    return this.request(order.id, 'SELLER', reason, itemIndexes, now);
  }

  /** Only the buyer gives up a refund: the key is the buyer's order token. */
  async withdrawByBuyer(token: string, now = new Date()) {
    const order = await this.prisma.checkoutOrder.findUnique({
      where: { publicToken: token },
      select: {
        id: true,
        companyId: true,
        refundRequests: {
          where: { status: 'REQUESTED' },
          select: { id: true },
        },
      },
    });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    const open = order.refundRequests[0];
    const updated = open
      ? await this.prisma.checkoutRefundRequest.updateMany({
          where: { id: open.id, status: 'REQUESTED' },
          data: { status: 'WITHDRAWN', withdrawnAt: now, resolvedAt: now },
        })
      : { count: 0 };
    if (!open || updated.count !== 1)
      throw this.conflict(
        'CHECKOUT_REFUND_NOT_OPEN',
        'Não há pedido de reembolso em aberto nesta compra.',
      );
    try {
      await this.webhooks.emit(
        this.prisma,
        order.companyId,
        'refund.withdrawn',
        order.id,
        { refundRequest: { id: open.id } },
      );
    } catch {
      this.logger.warn('CHECKOUT_REFUND_WITHDRAWN_EVENT_FAILED');
    }
    await this.queueMail(() =>
      this.mail.refundEmail('WITHDRAWN', order.id, open.id),
    );
    return { id: open.id, status: 'WITHDRAWN' as const };
  }

  /**
   * The seller asks Cifra+ to send the buyer the refund e-mail again (it has
   * the withdraw button). Once a day; the seller never gets the link.
   */
  async remindBuyer(
    companyId: string,
    orderId: string,
    userId: string,
    now = new Date(),
  ) {
    const open = await this.prisma.checkoutRefundRequest.findFirst({
      where: { orderId, companyId, status: 'REQUESTED', origin: 'BUYER' },
      select: { id: true },
    });
    if (!open)
      throw new NotFoundException('Pedido de reembolso não encontrado.');
    const claimed = await this.prisma.checkoutRefundRequest.updateMany({
      where: {
        id: open.id,
        status: 'REQUESTED',
        OR: [
          { buyerRemindedAt: null },
          {
            buyerRemindedAt: { lt: new Date(now.getTime() - REMIND_EVERY_MS) },
          },
        ],
      },
      data: { buyerRemindedAt: now },
    });
    if (claimed.count !== 1)
      throw this.conflict(
        'CHECKOUT_REFUND_REMIND_LIMIT',
        'O e-mail já foi reenviado nas últimas 24 horas.',
      );
    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'CHECKOUT_REFUND_BUYER_REMINDED',
        entityType: 'CheckoutRefundRequest',
        entityId: open.id,
      },
    });
    await this.queueMail(() =>
      this.mail.refundEmail(
        'RECEIVED',
        orderId,
        `${open.id}-${now.getTime()}`,
        { requestId: open.id },
      ),
    );
    return { remindedAt: now };
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
    orderId: string,
    origin: CheckoutRefundOrigin,
    reason: string,
    itemIndexes: number[],
    now: Date,
  ) {
    const order = await this.prisma.checkoutOrder.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        id: true,
        companyId: true,
        status: true,
        items: true,
        totalCents: true,
        ledgerEntries: {
          where: { kind: 'REFUND' },
          select: { amountCents: true },
        },
        refundRequests: {
          where: { status: { in: ['REQUESTED', 'DONE'] } },
          select: { status: true, itemIndexes: true },
        },
      },
    });
    if (order.status !== 'PAID')
      throw this.conflict(
        'CHECKOUT_REFUND_NOT_ALLOWED',
        'Este pedido não está pago ou já foi reembolsado.',
      );
    if (order.refundRequests.some((open) => open.status === 'REQUESTED'))
      throw this.conflict(
        'CHECKOUT_REFUND_ALREADY_REQUESTED',
        'Já existe um pedido de reembolso em análise para esta compra.',
      );
    const items = order.items as unknown as OrderItem[];
    const refunded = -order.ledgerEntries.reduce(
      (sum, entry) => sum + entry.amountCents,
      0,
    );
    const remaining = order.totalCents - refunded;
    const indexes = [...new Set(itemIndexes)].sort((a, b) => a - b);
    if (indexes.some((index) => !items[index]))
      throw new BadRequestException({
        code: 'CHECKOUT_REFUND_ITEM_INVALID',
        message: 'Escolha os itens desta compra.',
      });
    const done = new Set(
      order.refundRequests.flatMap((past) =>
        past.status === 'DONE' ? past.itemIndexes : [],
      ),
    );
    if (indexes.some((index) => done.has(index)))
      throw this.conflict(
        'CHECKOUT_REFUND_ITEM_REFUNDED',
        'Um dos itens escolhidos já foi reembolsado.',
      );
    // Every item left (or none chosen) is the rest of the order.
    const whole =
      !indexes.length ||
      items.every((_, index) => indexes.includes(index) || done.has(index));
    const shares = itemShares(items, order.totalCents);
    const amountCents = whole
      ? remaining
      : Math.min(
          remaining,
          indexes.reduce((sum, index) => sum + shares[index]!, 0),
        );
    const holdUntil =
      origin === 'BUYER' ? new Date(now.getTime() + REFUND_HOLD_MS) : null;
    const created = await this.prisma.checkoutRefundRequest.create({
      data: {
        companyId: order.companyId,
        orderId: order.id,
        origin,
        reason: reason.trim(),
        itemIndexes: whole ? [] : indexes,
        amountCents,
        holdUntil,
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        itemIndexes: true,
        amountCents: true,
        holdUntil: true,
      },
    });
    await this.alertAdmin(order.companyId, origin);
    try {
      await this.webhooks.emit(
        this.prisma,
        order.companyId,
        'refund.requested',
        order.id,
        {
          refundRequest: {
            id: created.id,
            origin,
            reason: reason.trim(),
            items: itemNames(items, created.itemIndexes),
            amountCents,
            holdUntil: holdUntil?.toISOString() ?? null,
          },
        },
      );
    } catch {
      // The request is saved; only the seller notice is missing.
      this.logger.warn('CHECKOUT_REFUND_REQUESTED_EVENT_FAILED');
    }
    // The buyer's copy has the withdraw button; a seller's request has none.
    if (origin === 'BUYER')
      await this.queueMail(() =>
        this.mail.refundEmail('RECEIVED', order.id, created.id, {
          requestId: created.id,
        }),
      );
    return created;
  }

  private async queueMail(enqueue: () => Promise<void>): Promise<void> {
    try {
      await enqueue();
    } catch {
      // The refund stands; the e-mail can be queued again by support.
      this.logger.error('CHECKOUT_REFUND_EMAIL_NOT_QUEUED');
    }
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
