import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CheckoutSubscription,
  CheckoutSubscriptionCancelReason,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutPlatformService } from './checkout-platform.service';
import { addMonths, subscriptionTokenHash } from './checkout-rules';
import {
  CheckoutWebhooksService,
  subscriptionPayload,
} from './checkout-webhooks.service';
import { EfiCheckoutSubscriptionClient } from './efi-checkout-subscription.client';

type Tx = Prisma.TransactionClient;

const AUDIT_RETENTION_MS = 5 * 365.25 * 86_400_000;
const LIVE = ['ACTIVE', 'PAST_DUE'] as const;

/** One paid cycle: the order and the subscription it belongs to. */
interface CycleOrder {
  id: string;
  companyId: string;
  subscriptionId: string;
}

/**
 * The life of a subscription after its signup: it starts with the first
 * payment, stops when someone cancels it, and its access ends on a date.
 */
@Injectable()
export class CheckoutSubscriptionsService {
  private readonly logger = new Logger(CheckoutSubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: CheckoutPlatformService,
    private readonly client: EfiCheckoutSubscriptionClient,
    private readonly webhooks: CheckoutWebhooksService,
  ) {}

  /** In the payment transaction: the first paid cycle starts it, once. */
  async activate(tx: Tx, order: CycleOrder, now: Date): Promise<void> {
    const pending = await tx.checkoutSubscription.findUnique({
      where: { id: order.subscriptionId },
      select: { intervalMonths: true },
    });
    if (!pending) return;
    const started = await tx.checkoutSubscription.updateMany({
      where: { id: order.subscriptionId, status: 'PENDING' },
      data: {
        status: 'ACTIVE',
        currentPeriodEnd: addMonths(now, pending.intervalMonths),
      },
    });
    if (started.count !== 1) return;
    await this.notify(tx, order, 'subscription.activated', now);
  }

  /**
   * Inside a money transaction (refund of the first cycle, chargeback): the
   * subscription and its access end now. The Efí is told afterwards, by
   * `stopAtEfi`, because it cannot be called from here.
   */
  async endNow(
    tx: Tx,
    order: CycleOrder,
    reason: CheckoutSubscriptionCancelReason,
    now: Date,
  ): Promise<void> {
    const ended = await tx.checkoutSubscription.updateMany({
      where: { id: order.subscriptionId, status: { in: [...LIVE] } },
      data: {
        status: 'CANCELED',
        cancelRequestedAt: now,
        canceledAt: now,
        cancelReason: reason,
        accessEndsAt: now,
        accessEndedNotifiedAt: now,
      },
    });
    if (ended.count !== 1) return;
    await this.notify(tx, order, 'subscription.canceled', now);
  }

  /** What the buyer sees with the link of the confirmation e-mail. */
  async viewByToken(token: string) {
    const subscription = await this.prisma.checkoutSubscription.findUnique({
      where: { tokenHash: subscriptionTokenHash(token) },
      select: {
        status: true,
        intervalMonths: true,
        currentPeriodEnd: true,
        canceledAt: true,
        accessEndsAt: true,
        product: { select: { name: true } },
        plan: { select: { name: true } },
        company: {
          select: {
            checkoutSettings: {
              select: {
                displayName: true,
                supportEmail: true,
                supportWhatsapp: true,
              },
            },
          },
        },
        // What the card is charged every cycle.
        orders: {
          where: { subscriptionCycle: 1 },
          select: { totalCents: true },
          take: 1,
        },
      },
    });
    if (!subscription) throw this.notFound();
    const settings = subscription.company.checkoutSettings;
    return {
      status: subscription.status,
      productName: subscription.product.name,
      planName: subscription.plan.name,
      intervalMonths: subscription.intervalMonths,
      cycleCents: subscription.orders[0]?.totalCents ?? null,
      currentPeriodEnd: subscription.currentPeriodEnd,
      canceledAt: subscription.canceledAt,
      accessEndsAt: subscription.accessEndsAt,
      seller: {
        displayName: settings?.displayName ?? null,
        supportEmail: settings?.supportEmail ?? null,
        supportWhatsapp: settings?.supportWhatsapp ?? null,
      },
    };
  }

  /** The buyer cancels: only the token of the e-mail is needed. */
  async cancelByToken(token: string, now = new Date()) {
    const subscription = await this.prisma.checkoutSubscription.findUnique({
      where: { tokenHash: subscriptionTokenHash(token) },
    });
    if (!subscription) throw this.notFound();
    await this.stop(subscription, 'BUYER', null, now);
    return this.viewByToken(token);
  }

  /** The seller or the admin cancels a subscription of this company. */
  async cancel(
    companyId: string,
    id: string,
    by: 'SELLER' | 'ADMIN',
    userId: string,
    now = new Date(),
  ): Promise<void> {
    const subscription = await this.prisma.checkoutSubscription.findFirst({
      where: { id, companyId },
    });
    // Another company's subscription is simply not found.
    if (!subscription) throw this.notFound();
    await this.stop(subscription, by, userId, now);
  }

  /** Subscriptions of one company, newest first. */
  async list(companyId: string, page = 1, pageSize = 20) {
    const where = { companyId, status: { not: 'PENDING' as const } };
    const [total, rows] = await Promise.all([
      this.prisma.checkoutSubscription.count({ where }),
      this.prisma.checkoutSubscription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          status: true,
          buyerName: true,
          buyerEmail: true,
          buyerPhone: true,
          intervalMonths: true,
          cycleCents: true,
          currentPeriodEnd: true,
          canceledAt: true,
          cancelReason: true,
          accessEndsAt: true,
          createdAt: true,
          product: { select: { name: true } },
          plan: { select: { name: true } },
        },
      }),
    ]);
    return { total, page, pageSize, items: rows };
  }

  /**
   * Worker: tells the seller system, once, that the access of a canceled
   * subscription ended.
   */
  async notifyEnded(now = new Date()): Promise<void> {
    const due = await this.prisma.checkoutSubscription.findMany({
      where: {
        status: 'CANCELED',
        accessEndsAt: { lte: now },
        accessEndedNotifiedAt: null,
      },
      orderBy: { accessEndsAt: 'asc' },
      take: 50,
      select: { id: true, companyId: true },
    });
    for (const subscription of due)
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.checkoutSubscription.updateMany({
          where: { id: subscription.id, accessEndedNotifiedAt: null },
          data: { accessEndedNotifiedAt: now },
        });
        if (claimed.count !== 1) return;
        const order = await this.lastOrder(tx, subscription.id);
        if (order)
          await this.notify(
            tx,
            {
              id: order.id,
              companyId: subscription.companyId,
              subscriptionId: subscription.id,
            },
            'subscription.canceled',
            now,
          );
      });
  }

  /**
   * Worker: nothing that ended here may keep charging at the Efí. Covers a
   * signup whose first payment never came and a subscription ended inside a
   * money transaction. A failure is tried again on the next tick.
   */
  async stopAtEfi(now = new Date()): Promise<void> {
    const due = await this.prisma.checkoutSubscription.findMany({
      where: {
        efiCanceledAt: null,
        OR: [
          { status: 'CANCELED', efiSubscriptionId: { not: null } },
          {
            status: 'PENDING',
            orders: {
              some: {
                subscriptionCycle: 1,
                status: { in: ['DECLINED', 'EXPIRED', 'FAILED'] },
              },
            },
          },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: 50,
    });
    for (const subscription of due) {
      try {
        await this.cancelAtEfi(subscription);
      } catch {
        this.logger.warn('CHECKOUT_SUBSCRIPTION_EFI_CANCEL_PENDING');
        continue;
      }
      await this.prisma.checkoutSubscription.updateMany({
        where: { id: subscription.id },
        data:
          subscription.status === 'PENDING'
            ? {
                // Never paid: it ends without ever giving access.
                efiCanceledAt: now,
                status: 'CANCELED',
                canceledAt: now,
                cancelReason: 'PAYMENT_FAILED',
                accessEndsAt: now,
                accessEndedNotifiedAt: now,
              }
            : { efiCanceledAt: now },
      });
    }
  }

  /**
   * A cancellation asked by someone. The Efí comes first: while it may still
   * charge, nothing changes here. The access goes on until the paid period ends.
   */
  private async stop(
    subscription: CheckoutSubscription,
    reason: 'BUYER' | 'SELLER' | 'ADMIN',
    userId: string | null,
    now: Date,
  ): Promise<void> {
    if (subscription.status !== 'CANCELED')
      try {
        await this.cancelAtEfi(subscription);
      } catch {
        throw new BadGatewayException({
          code: 'EFI_UNAVAILABLE',
          message:
            'Não foi possível cancelar agora. Tente de novo em instantes.',
        });
      }
    await this.prisma.$transaction(async (tx) => {
      const accessEndsAt =
        subscription.currentPeriodEnd && subscription.currentPeriodEnd > now
          ? subscription.currentPeriodEnd
          : now;
      const ended = accessEndsAt <= now;
      const canceled = await tx.checkoutSubscription.updateMany({
        where: { id: subscription.id, status: { in: [...LIVE] } },
        data: {
          status: 'CANCELED',
          cancelRequestedAt: now,
          canceledAt: now,
          cancelReason: reason,
          accessEndsAt,
          efiCanceledAt: now,
          ...(ended ? { accessEndedNotifiedAt: now } : {}),
        },
      });
      // Canceled before (a second click, another person): nothing to add.
      if (canceled.count !== 1) return;
      if (userId)
        await tx.auditLog.create({
          data: {
            companyId: subscription.companyId,
            userId,
            entityType: 'CheckoutSubscription',
            entityId: subscription.id,
            action: 'CHECKOUT_SUBSCRIPTION_CANCELED',
            changes: { by: reason, accessEndsAt: accessEndsAt.toISOString() },
            retentionExpiresAt: new Date(now.getTime() + AUDIT_RETENTION_MS),
          },
        });
      const order = await this.lastOrder(tx, subscription.id);
      if (order)
        await this.notify(
          tx,
          {
            id: order.id,
            companyId: subscription.companyId,
            subscriptionId: subscription.id,
          },
          // With access left, the seller gets the date now and the end later.
          ended ? 'subscription.canceled' : 'subscription.renewal_disabled',
          now,
        );
    });
  }

  private async cancelAtEfi(
    subscription: Pick<
      CheckoutSubscription,
      'efiSubscriptionId' | 'issuerIdentityId'
    >,
  ): Promise<void> {
    // The signup never reached the Efí: there is nothing to stop.
    if (!subscription.efiSubscriptionId) return;
    const account = await this.platform.accountOf(
      subscription.issuerIdentityId,
    );
    if (!account) throw new Error('CHECKOUT_ISSUER_UNAVAILABLE');
    await this.client.cancel(account, subscription.efiSubscriptionId);
  }

  private lastOrder(tx: Tx, subscriptionId: string) {
    return tx.checkoutOrder.findFirst({
      where: { subscriptionId },
      orderBy: { subscriptionCycle: 'desc' },
      select: { id: true },
    });
  }

  private async notify(
    tx: Tx,
    order: CycleOrder,
    type:
      | 'subscription.activated'
      | 'subscription.renewal_disabled'
      | 'subscription.canceled',
    now: Date,
  ): Promise<void> {
    const subscription = await tx.checkoutSubscription.findUnique({
      where: { id: order.subscriptionId },
    });
    if (!subscription) return;
    await this.webhooks.emit(
      tx,
      order.companyId,
      type,
      order.id,
      { subscription: subscriptionPayload(subscription) },
      now,
    );
  }

  private notFound() {
    return new NotFoundException('Assinatura não encontrada.');
  }
}
