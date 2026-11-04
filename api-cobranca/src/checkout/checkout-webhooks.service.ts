import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CheckoutWebhookDelivery, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { ResendMailerService } from '../common/resend-mailer.service';
import type { OrderItem } from './checkout-pricing';
import {
  CheckoutWebhookSender,
  webhookUrlProblem,
} from './checkout-webhook.sender';

type Client = Prisma.TransactionClient | PrismaService;

export type CheckoutEventType =
  | 'order.created'
  | 'order.paid'
  | 'order.pix_expired'
  | 'order.refunded'
  | 'order.chargeback'
  | 'refund.requested'
  | 'webhook.test';

// After each failed attempt; the last one repeats until the 24 h window ends.
export const RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
  2 * 3_600_000,
  4 * 3_600_000,
  8 * 3_600_000,
];
export const RETRY_WINDOW_MS = 24 * 3_600_000;
export const DISABLE_AFTER_MS = 3 * 86_400_000;
const CLAIM_MS = 2 * 60_000;

function addMonths(date: Date, months: number): Date {
  const copy = new Date(date);
  copy.setUTCMonth(copy.getUTCMonth() + months);
  return copy;
}

@Injectable()
export class CheckoutWebhooksService {
  private readonly logger = new Logger(CheckoutWebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: CheckoutWebhookSender,
    private readonly crypto: PaymentCryptoService,
    private readonly config: ConfigService,
    private readonly mailer: ResendMailerService,
  ) {}

  /**
   * Records one event for the seller system, inside the caller's transaction
   * when given, so the notice exists exactly when the change does.
   */
  async emit(
    client: Client,
    companyId: string,
    type: CheckoutEventType,
    orderId: string | null,
    extra: Record<string, Prisma.InputJsonValue> = {},
    now = new Date(),
  ): Promise<string | null> {
    const settings = await client.checkoutSettings.findUnique({
      where: { companyId },
      select: { webhookUrl: true, webhookDisabledAt: true },
    });
    if (!settings?.webhookUrl) return null;
    const eventId = `evt_${randomBytes(16).toString('hex')}`;
    const order = orderId ? await this.orderData(client, orderId) : null;
    const payload = {
      id: eventId,
      type,
      createdAt: now.toISOString(),
      data: { ...(order ? { order } : {}), ...extra },
    };
    await client.checkoutWebhookDelivery.create({
      data: {
        companyId,
        orderId,
        eventId,
        eventType: type,
        payload,
        status: settings.webhookDisabledAt ? 'SKIPPED' : 'PENDING',
        nextAttemptAt: settings.webhookDisabledAt ? null : now,
        retryUntil: new Date(now.getTime() + RETRY_WINDOW_MS),
      },
    });
    return eventId;
  }

  /** Sends what is due. Each row is claimed first, so two workers never send it twice. */
  async deliverDue(now = new Date()): Promise<void> {
    const due = await this.prisma.checkoutWebhookDelivery.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: 'asc' },
      take: 20,
    });
    for (const delivery of due) {
      const claimed = await this.prisma.checkoutWebhookDelivery.updateMany({
        where: {
          id: delivery.id,
          status: 'PENDING',
          nextAttemptAt: { lte: now },
        },
        data: { nextAttemptAt: new Date(now.getTime() + CLAIM_MS) },
      });
      if (claimed.count === 1) await this.attempt(delivery, now);
    }
  }

  async attempt(delivery: CheckoutWebhookDelivery, now = new Date()) {
    const settings = await this.prisma.checkoutSettings.findUnique({
      where: { companyId: delivery.companyId },
      select: {
        webhookUrl: true,
        webhookSecretEncrypted: true,
        webhookDisabledAt: true,
      },
    });
    if (
      !settings?.webhookUrl ||
      !settings.webhookSecretEncrypted ||
      settings.webhookDisabledAt
    )
      return this.prisma.checkoutWebhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'SKIPPED', nextAttemptAt: null },
      });
    const result = await this.sender.send(
      {
        url: settings.webhookUrl,
        secret: this.crypto.decrypt(settings.webhookSecretEncrypted),
      },
      { id: delivery.eventId, type: delivery.eventType },
      JSON.stringify(delivery.payload),
      now,
    );
    const attempts = delivery.attempts + 1;
    if (result.ok) {
      await this.prisma.checkoutSettings.updateMany({
        where: {
          companyId: delivery.companyId,
          webhookFailingSince: { not: null },
        },
        data: { webhookFailingSince: null },
      });
      return this.prisma.checkoutWebhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'DELIVERED',
          attempts,
          deliveredAt: now,
          nextAttemptAt: null,
          lastStatusCode: result.statusCode,
          lastError: null,
        },
      });
    }
    const delay =
      RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length) - 1] ??
      RETRY_WINDOW_MS;
    const next = new Date(now.getTime() + delay);
    const updated = await this.prisma.checkoutWebhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: next > delivery.retryUntil ? 'FAILED' : 'PENDING',
        attempts,
        nextAttemptAt: next > delivery.retryUntil ? null : next,
        lastStatusCode: result.statusCode,
        lastError: result.error,
      },
    });
    await this.recordFailure(delivery.companyId, now);
    return updated;
  }

  async view(companyId: string) {
    const settings = await this.settings(companyId);
    return {
      url: settings.webhookUrl,
      hasSecret: Boolean(settings.webhookSecretEncrypted),
      failingSince: settings.webhookFailingSince,
      disabledAt: settings.webhookDisabledAt,
      version: settings.version,
    };
  }

  /**
   * A first URL also gets its secret, shown only in this answer. The page
   * settings version is left alone: this is a separate form on the same page.
   */
  async setUrl(companyId: string, url: string | null) {
    const trimmed = url?.trim() || null;
    const problem = trimmed ? webhookUrlProblem(trimmed) : null;
    if (problem)
      throw new BadRequestException({
        code: 'CHECKOUT_WEBHOOK_URL',
        message: problem,
      });
    const current = await this.settings(companyId);
    const secret =
      trimmed && !current.webhookSecretEncrypted ? this.newSecret() : null;
    await this.prisma.checkoutSettings.update({
      where: { companyId },
      data: {
        webhookUrl: trimmed,
        ...(secret
          ? { webhookSecretEncrypted: this.crypto.encrypt(secret) }
          : {}),
        webhookFailingSince: null,
      },
    });
    return { ...(await this.view(companyId)), secret };
  }

  /** A new secret replaces the old one at once; shown only in this answer. */
  async rotateSecret(companyId: string) {
    await this.settings(companyId);
    const secret = this.newSecret();
    await this.prisma.checkoutSettings.update({
      where: { companyId },
      data: { webhookSecretEncrypted: this.crypto.encrypt(secret) },
    });
    return { secret };
  }

  async enable(companyId: string) {
    await this.settings(companyId);
    await this.prisma.checkoutSettings.update({
      where: { companyId },
      data: { webhookDisabledAt: null, webhookFailingSince: null },
    });
    return this.view(companyId);
  }

  /** Sends a sample event now and says what the seller system answered. */
  async test(companyId: string, now = new Date()) {
    const settings = await this.settings(companyId);
    if (!settings.webhookUrl)
      throw new ConflictException({
        code: 'CHECKOUT_WEBHOOK_MISSING',
        message: 'Salve a URL do webhook antes de testar.',
      });
    const eventId = await this.emit(
      this.prisma,
      companyId,
      'webhook.test',
      null,
      { message: 'Teste do webhook do Cifra+ Checkout.' },
      now,
    );
    const delivery =
      await this.prisma.checkoutWebhookDelivery.findUniqueOrThrow({
        where: { eventId: eventId ?? '' },
      });
    const result = await this.attempt(delivery, now);
    return this.row(result);
  }

  async deliveries(companyId: string, page: number, pageSize: number) {
    const where = { companyId };
    const [total, rows] = await Promise.all([
      this.prisma.checkoutWebhookDelivery.count({ where }),
      this.prisma.checkoutWebhookDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items: rows.map((row) => this.row(row)) };
  }

  async resend(companyId: string, deliveryId: string, now = new Date()) {
    const settings = await this.settings(companyId);
    if (settings.webhookDisabledAt)
      throw new ConflictException({
        code: 'CHECKOUT_WEBHOOK_DISABLED',
        message: 'Religue o webhook antes de reenviar.',
      });
    const updated = await this.prisma.checkoutWebhookDelivery.updateMany({
      where: { id: deliveryId, companyId, status: { not: 'PENDING' } },
      data: {
        status: 'PENDING',
        nextAttemptAt: now,
        retryUntil: new Date(now.getTime() + RETRY_WINDOW_MS),
      },
    });
    if (updated.count !== 1)
      throw new NotFoundException('Aviso não encontrado ou já na fila.');
  }

  /** History without the body: it carries the buyer's personal data. */
  private row(delivery: CheckoutWebhookDelivery) {
    return {
      id: delivery.id,
      eventId: delivery.eventId,
      eventType: delivery.eventType,
      orderId: delivery.orderId,
      status: delivery.status,
      attempts: delivery.attempts,
      lastStatusCode: delivery.lastStatusCode,
      lastError: delivery.lastError,
      nextAttemptAt: delivery.nextAttemptAt,
      deliveredAt: delivery.deliveredAt,
      createdAt: delivery.createdAt,
    };
  }

  /**
   * Three days in a row without one success turns the webhook off: pending
   * notices are skipped and the seller is told by e-mail.
   */
  private async recordFailure(companyId: string, now: Date) {
    await this.prisma.checkoutSettings.updateMany({
      where: { companyId, webhookFailingSince: null },
      data: { webhookFailingSince: now },
    });
    const disabled = await this.prisma.checkoutSettings.updateMany({
      where: {
        companyId,
        webhookDisabledAt: null,
        webhookFailingSince: {
          lte: new Date(now.getTime() - DISABLE_AFTER_MS),
        },
      },
      data: { webhookDisabledAt: now },
    });
    if (disabled.count !== 1) return;
    await this.prisma.checkoutWebhookDelivery.updateMany({
      where: { companyId, status: 'PENDING' },
      data: { status: 'SKIPPED', nextAttemptAt: null },
    });
    await this.tellSeller(companyId);
  }

  private async tellSeller(companyId: string) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    const from = this.config.get<string>('RESEND_FROM_EMAIL');
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { email: true },
    });
    if (!apiKey || !from || !company) return;
    try {
      await this.mailer.sendEmail({
        apiKey,
        from,
        to: [company.email],
        subject: 'Webhook do Cifra+ Checkout desligado',
        html: '<p>O endereço do seu webhook não respondeu com sucesso por 3 dias seguidos, então paramos de enviar os avisos.</p><p>Confira o seu sistema e, em Configurações do checkout → Webhook, clique em "Religar". Os avisos desse período ficam no histórico para reenviar.</p>',
      });
    } catch {
      this.logger.warn('CHECKOUT_WEBHOOK_DISABLED_EMAIL_FAILED');
    }
  }

  private async orderData(client: Client, orderId: string) {
    const order = await client.checkoutOrder.findUnique({
      where: { id: orderId },
    });
    if (!order) return null;
    const items = order.items as unknown as OrderItem[];
    return {
      id: order.id,
      status: order.status,
      paidAt: order.paidAt,
      totalCents: order.totalCents,
      subtotalCents: order.subtotalCents,
      discountCents: order.discountCents,
      surchargeCents: order.surchargeCents,
      couponCode: order.couponCode,
      utm: order.utm,
      buyer: {
        name: order.buyerName,
        email: order.buyerEmail,
        document: order.buyerDocument,
        phone: order.buyerPhone,
      },
      items: items.map((line) => ({
        kind: line.kind,
        productId: line.productId,
        name: line.name,
        unitPriceCents: line.unitPriceCents,
        discountCents: line.discountCents,
        accessPeriodMonths: line.accessPeriodMonths,
        accessExpiresAt:
          order.paidAt && line.accessPeriodMonths
            ? addMonths(order.paidAt, line.accessPeriodMonths).toISOString()
            : null,
      })),
    } as unknown as Prisma.InputJsonValue;
  }

  private async settings(companyId: string) {
    const settings = await this.prisma.checkoutSettings.findUnique({
      where: { companyId },
    });
    if (!settings)
      throw new NotFoundException('Configurações não encontradas.');
    return settings;
  }

  private newSecret(): string {
    return `whsec_${randomBytes(24).toString('base64url')}`;
  }
}
