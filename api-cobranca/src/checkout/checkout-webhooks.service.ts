import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CheckoutOffer,
  CheckoutOrder,
  CheckoutWebhookDelivery,
  CheckoutWebhookRule,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { ResendMailerService } from '../common/resend-mailer.service';
import type { OrderItem } from './checkout-pricing';
import { addMonths } from './checkout-rules';
import {
  CheckoutWebhookSender,
  webhookUrlProblem,
} from './checkout-webhook.sender';

type Client = Prisma.TransactionClient | PrismaService;

/** Events a rule may choose; the test is sent only on request. */
export const WEBHOOK_EVENTS = [
  'order.created',
  'order.paid',
  'order.pix_expired',
  'order.card_declined',
  'order.refunded',
  'order.chargeback',
  'refund.requested',
  'refund.withdrawn',
  'lead.abandoned',
] as const;

export type CheckoutEventType =
  | (typeof WEBHOOK_EVENTS)[number]
  | 'webhook.test';

export const MAX_WEBHOOK_RULES = 10;

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

export interface WebhookRuleInput {
  name: string;
  url: string;
  events?: string[];
  productIds?: string[];
}

/** The order as the seller system sees it, in notices and in the API. */
export function orderPayload(
  order: CheckoutOrder & { offer: Pick<CheckoutOffer, 'id' | 'kind'> | null },
) {
  const items = order.items as unknown as OrderItem[];
  return {
    id: order.id,
    status: order.status,
    // An accepted upsell or downsell: its own order, tied to the purchase.
    parentOrderId: order.parentOrderId,
    offer: order.offer,
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
  };
}

/** Products an event is about: the order items, or the product of a lead. */
function eventProducts(
  order: { items: Array<{ productId: string }> } | null,
  extra: Record<string, Prisma.InputJsonValue>,
): string[] {
  if (order) return order.items.map((item) => item.productId);
  const lead = extra.lead as { productId?: unknown } | undefined;
  return typeof lead?.productId === 'string' ? [lead.productId] : [];
}

function ruleWants(
  rule: Pick<CheckoutWebhookRule, 'events' | 'productIds'>,
  type: CheckoutEventType,
  products: string[],
): boolean {
  if (rule.events.length && !rule.events.includes(type)) return false;
  // A product rule wants the product sold, as the main item or as a bump.
  return (
    !rule.productIds.length ||
    products.some((id) => rule.productIds.includes(id))
  );
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
   * Records one event for each rule that wants it, inside the caller's
   * transaction when given, so the notice exists exactly when the change does.
   * The event id is the same for every rule, so the seller can drop repeats.
   */
  async emit(
    client: Client,
    companyId: string,
    type: CheckoutEventType,
    orderId: string | null,
    extra: Record<string, Prisma.InputJsonValue> = {},
    now = new Date(),
  ): Promise<string | null> {
    const rules = await client.checkoutWebhookRule.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!rules.length) return null;
    const order = orderId ? await this.orderData(client, orderId) : null;
    const products = eventProducts(order, extra);
    const wanted = rules.filter((rule) => ruleWants(rule, type, products));
    if (!wanted.length) return null;
    const eventId = `evt_${randomBytes(16).toString('hex')}`;
    const payload = {
      id: eventId,
      type,
      createdAt: now.toISOString(),
      data: { ...(order ? { order } : {}), ...extra },
    } as unknown as Prisma.InputJsonValue;
    await client.checkoutWebhookDelivery.createMany({
      data: wanted.map((rule) => ({
        companyId,
        ruleId: rule.id,
        orderId,
        eventId,
        eventType: type,
        payload,
        status: rule.disabledAt ? 'SKIPPED' : 'PENDING',
        nextAttemptAt: rule.disabledAt ? null : now,
        retryUntil: new Date(now.getTime() + RETRY_WINDOW_MS),
      })),
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
    // A notice written by the API before Part 9 has no rule: it goes to the
    // first rule, which the migration made from the single webhook.
    const rule = delivery.ruleId
      ? await this.prisma.checkoutWebhookRule.findUnique({
          where: { id: delivery.ruleId },
        })
      : await this.prisma.checkoutWebhookRule.findFirst({
          where: { companyId: delivery.companyId, deletedAt: null },
          orderBy: { createdAt: 'asc' },
        });
    if (!rule || rule.deletedAt || rule.disabledAt)
      return this.prisma.checkoutWebhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'SKIPPED', nextAttemptAt: null },
      });
    const result = await this.sender.send(
      { url: rule.url, secret: this.crypto.decrypt(rule.secretEncrypted) },
      { id: delivery.eventId, type: delivery.eventType },
      JSON.stringify(delivery.payload),
      now,
    );
    const attempts = delivery.attempts + 1;
    if (result.ok) {
      await this.prisma.checkoutWebhookRule.updateMany({
        where: { id: rule.id, failingSince: { not: null } },
        data: { failingSince: null },
      });
      return this.prisma.checkoutWebhookDelivery.update({
        where: { id: delivery.id },
        data: {
          ruleId: rule.id,
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
        ruleId: rule.id,
        status: next > delivery.retryUntil ? 'FAILED' : 'PENDING',
        attempts,
        nextAttemptAt: next > delivery.retryUntil ? null : next,
        lastStatusCode: result.statusCode,
        lastError: result.error,
      },
    });
    await this.recordFailure(rule, now);
    return updated;
  }

  async list(companyId: string) {
    const rules = await this.prisma.checkoutWebhookRule.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return rules.map((rule) => this.view(rule));
  }

  /** A new rule gets its own secret, shown only in this answer. */
  async create(companyId: string, input: WebhookRuleInput) {
    const data = await this.checked(companyId, input);
    const count = await this.prisma.checkoutWebhookRule.count({
      where: { companyId, deletedAt: null },
    });
    if (count >= MAX_WEBHOOK_RULES)
      throw new ConflictException({
        code: 'CHECKOUT_WEBHOOK_RULE_LIMIT',
        message: `Use no máximo ${MAX_WEBHOOK_RULES} regras de webhook.`,
      });
    const secret = this.newSecret();
    const rule = await this.prisma.checkoutWebhookRule.create({
      data: {
        companyId,
        ...data,
        secretEncrypted: this.crypto.encrypt(secret),
      },
    });
    return { ...this.view(rule), secret };
  }

  async update(
    companyId: string,
    id: string,
    input: WebhookRuleInput & { version: number },
  ) {
    const data = await this.checked(companyId, input);
    const updated = await this.prisma.checkoutWebhookRule.updateMany({
      where: { id, companyId, deletedAt: null, version: input.version },
      // A new address starts with a clean failure count.
      data: { ...data, failingSince: null, version: { increment: 1 } },
    });
    if (updated.count !== 1) {
      await this.rule(companyId, id);
      throw new ConflictException({
        code: 'VERSION_CHANGED',
        message: 'A regra foi alterada em outra tela. Recarregue.',
      });
    }
    return this.view(await this.rule(companyId, id));
  }

  /** The rule leaves the list; its history stays and its queue is skipped. */
  async remove(companyId: string, id: string, now = new Date()) {
    const removed = await this.prisma.checkoutWebhookRule.updateMany({
      where: { id, companyId, deletedAt: null },
      data: { deletedAt: now },
    });
    if (removed.count !== 1) throw this.notFound();
    await this.prisma.checkoutWebhookDelivery.updateMany({
      where: { ruleId: id, status: 'PENDING' },
      data: { status: 'SKIPPED', nextAttemptAt: null },
    });
  }

  /** A new secret replaces the old one at once; shown only in this answer. */
  async rotateSecret(companyId: string, id: string) {
    await this.rule(companyId, id);
    const secret = this.newSecret();
    await this.prisma.checkoutWebhookRule.update({
      where: { id },
      data: { secretEncrypted: this.crypto.encrypt(secret) },
    });
    return { secret };
  }

  async enable(companyId: string, id: string) {
    await this.rule(companyId, id);
    const rule = await this.prisma.checkoutWebhookRule.update({
      where: { id },
      data: { disabledAt: null, failingSince: null },
    });
    return this.view(rule);
  }

  /** Sends a sample event to one rule now and says what its system answered. */
  async test(companyId: string, id: string, now = new Date()) {
    await this.rule(companyId, id);
    const eventId = `evt_${randomBytes(16).toString('hex')}`;
    const delivery = await this.prisma.checkoutWebhookDelivery.create({
      data: {
        companyId,
        ruleId: id,
        orderId: null,
        eventId,
        eventType: 'webhook.test',
        payload: {
          id: eventId,
          type: 'webhook.test',
          createdAt: now.toISOString(),
          data: { message: 'Teste do webhook do Cifra+ Checkout.' },
        },
        nextAttemptAt: now,
        retryUntil: new Date(now.getTime() + RETRY_WINDOW_MS),
      },
    });
    return this.row(await this.attempt(delivery, now));
  }

  async deliveries(
    companyId: string,
    ruleId: string,
    page: number,
    pageSize: number,
  ) {
    await this.rule(companyId, ruleId);
    const where = { companyId, ruleId };
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
    const delivery = await this.prisma.checkoutWebhookDelivery.findFirst({
      where: { id: deliveryId, companyId },
      select: { rule: { select: { disabledAt: true, deletedAt: true } } },
    });
    if (!delivery) throw new NotFoundException('Aviso não encontrado.');
    if (!delivery.rule || delivery.rule.deletedAt || delivery.rule.disabledAt)
      throw new ConflictException({
        code: 'CHECKOUT_WEBHOOK_DISABLED',
        message: 'Religue a regra antes de reenviar.',
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

  /** The order body of the notices, for the read-only API. */
  async orderData(client: Client, orderId: string) {
    const order = await client.checkoutOrder.findUnique({
      where: { id: orderId },
      include: { offer: { select: { id: true, kind: true } } },
    });
    return order ? orderPayload(order) : null;
  }

  private view(rule: CheckoutWebhookRule) {
    return {
      id: rule.id,
      name: rule.name,
      url: rule.url,
      events: rule.events,
      productIds: rule.productIds,
      failingSince: rule.failingSince,
      disabledAt: rule.disabledAt,
      version: rule.version,
      createdAt: rule.createdAt,
    };
  }

  /** History without the body: it carries the buyer's personal data. */
  private row(delivery: CheckoutWebhookDelivery) {
    return {
      id: delivery.id,
      ruleId: delivery.ruleId,
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

  /** URL rules and products of this company only (another one's is "not found"). */
  private async checked(companyId: string, input: WebhookRuleInput) {
    const url = input.url.trim();
    const problem = webhookUrlProblem(url);
    if (problem)
      throw new BadRequestException({
        code: 'CHECKOUT_WEBHOOK_URL',
        message: problem,
      });
    const productIds = [...new Set(input.productIds ?? [])];
    if (productIds.length) {
      const found = await this.prisma.checkoutProduct.count({
        where: { companyId, id: { in: productIds } },
      });
      if (found !== productIds.length)
        throw new BadRequestException({
          code: 'CHECKOUT_WEBHOOK_PRODUCT',
          message: 'Produto não encontrado.',
        });
    }
    return {
      name: input.name.trim(),
      url,
      events: [...new Set(input.events ?? [])],
      productIds,
    };
  }

  /**
   * Three days in a row without one success turn the rule off: its pending
   * notices are skipped and the seller is told by e-mail. Other rules go on.
   */
  private async recordFailure(rule: CheckoutWebhookRule, now: Date) {
    await this.prisma.checkoutWebhookRule.updateMany({
      where: { id: rule.id, failingSince: null },
      data: { failingSince: now },
    });
    const disabled = await this.prisma.checkoutWebhookRule.updateMany({
      where: {
        id: rule.id,
        disabledAt: null,
        failingSince: {
          lte: new Date(now.getTime() - DISABLE_AFTER_MS),
        },
      },
      data: { disabledAt: now },
    });
    if (disabled.count !== 1) return;
    await this.prisma.checkoutWebhookDelivery.updateMany({
      where: { ruleId: rule.id, status: 'PENDING' },
      data: { status: 'SKIPPED', nextAttemptAt: null },
    });
    await this.tellSeller(rule.companyId, rule.name);
  }

  private async tellSeller(companyId: string, ruleName: string) {
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
        html: `<p>O endereço da regra de webhook "${escapeHtml(ruleName)}" não respondeu com sucesso por 3 dias seguidos, então paramos de enviar os avisos dessa regra. As outras regras continuam.</p><p>Confira o seu sistema e, em Configurações do checkout → Webhooks, clique em "Religar" nessa regra. Os avisos desse período ficam no histórico para reenviar.</p>`,
      });
    } catch {
      this.logger.warn('CHECKOUT_WEBHOOK_DISABLED_EMAIL_FAILED');
    }
  }

  private async rule(companyId: string, id: string) {
    const rule = await this.prisma.checkoutWebhookRule.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!rule) throw this.notFound();
    return rule;
  }

  private notFound() {
    return new NotFoundException('Regra de webhook não encontrada.');
  }

  private newSecret(): string {
    return `whsec_${randomBytes(24).toString('base64url')}`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
