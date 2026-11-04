import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CheckoutCardAttempt, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { grossUpCard } from '../payment/card-amounts';
import { cardProcessingBasisPoints } from '../payment/efi-card.client';
import {
  CheckoutCatalogService,
  type SaleContext,
} from './checkout-catalog.service';
import {
  CheckoutPlatformService,
  type CheckoutCardAccount,
} from './checkout-platform.service';
import {
  CARD_ATTEMPTS_PER_ORDER,
  CheckoutOrdersService,
} from './checkout-orders.service';
import { CheckoutPaymentsService } from './checkout-payments.service';
import { CheckoutWebhooksService } from './checkout-webhooks.service';
import { markConverted } from './checkout-recovery.service';
import type { OrderItem } from './checkout-pricing';
import { normalizeDocument } from './checkout-rules';
import {
  EfiCheckoutCardClient,
  type CheckoutCardAddress,
  type CheckoutCardBrand,
} from './efi-checkout-card.client';
import type {
  CheckoutCardOrderDto,
  CheckoutCardPayDto,
  CheckoutCardQuoteDto,
} from './dto/checkout-card.dto';

export const CARD_QUOTE_VALIDITY_MS = 10 * 60_000;
// Against testing stolen cards: tries per buyer document in 24 hours.
export const CARD_ATTEMPTS_PER_DOCUMENT = 5;
// A charge the Efí never shows by its custom_id after this did not happen.
const NOT_FOUND_AFTER_MS = 30 * 60_000;
const BUSY = ['SUBMITTING', 'APPROVED', 'UNCERTAIN'] as const;
// The anomaly table accepts PIX, CHARGES or CARD; checkout reasons carry a prefix.
const ANOMALY_SOURCE = 'CARD';

export interface CardOption {
  installments: number;
  installmentValueCents: number;
  submissionCents: number;
  totalCents: number;
  efiFeeCents: number;
}

/** Same cart, same price: what a quote and an order must agree on. */
export function cartFingerprint(cart: {
  productId: string;
  items: Pick<
    OrderItem,
    'kind' | 'productId' | 'bumpId' | 'unitPriceCents' | 'discountCents'
  >[];
  couponId: string | null;
  subtotalCents: number;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        productId: cart.productId,
        items: cart.items.map((line) => [
          line.kind,
          line.productId,
          line.bumpId,
          line.unitPriceCents,
          line.discountCents,
        ]),
        couponId: cart.couponId,
        subtotalCents: cart.subtotalCents,
      }),
    )
    .digest('hex');
}

function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function conflictWith(code: string, message: string): never {
  throw new ConflictException({ code, message });
}

// Efí status → attempt status. Anything else is reviewed by the admin.
function mapStatus(status: string): CheckoutCardAttempt['status'] | null {
  if (status === 'paid') return 'PAID';
  if (['approved', 'waiting', 'identified'].includes(status)) return 'APPROVED';
  if (status === 'unpaid') return 'DECLINED';
  if (['canceled', 'expired'].includes(status)) return 'CANCELED';
  return null;
}

/**
 * Card sales on the CifraMais account. The browser tokenizes the card with
 * the Efí; this service only sees the token. An attempt is saved before the
 * charge is sent, and an answer that is lost is reconciled, never resent.
 */
@Injectable()
export class CheckoutCardService {
  private readonly logger = new Logger(CheckoutCardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CheckoutCatalogService,
    private readonly platform: CheckoutPlatformService,
    private readonly orders: CheckoutOrdersService,
    private readonly payments: CheckoutPaymentsService,
    private readonly webhooks: CheckoutWebhooksService,
    private readonly client: EfiCheckoutCardClient,
  ) {}

  /** Installments for the cart and brand, priced by the server. */
  async quote(slug: string, dto: CheckoutCardQuoteDto, now = new Date()) {
    const sale = await this.catalog.prepare(slug, dto, now, 'CARD');
    const card = sale.card!;
    const options = await this.price(sale, card, dto.brand);
    const quote = await this.prisma.checkoutCardQuote.create({
      data: {
        companyId: sale.companyId,
        productId: sale.productId,
        platformSettingsId: card.account.settings.id,
        fingerprint: cartFingerprint({
          ...sale.quote,
          productId: sale.productId,
        }),
        brand: dto.brand,
        options: options as unknown as Prisma.InputJsonValue,
        validUntil: new Date(now.getTime() + CARD_QUOTE_VALIDITY_MS),
      },
    });
    return {
      quoteId: quote.id,
      validUntil: quote.validUntil,
      // The browser needs both to tokenize the card with the Efí.
      payeeCode: card.payeeCode,
      environment:
        card.account.identity.environment === 'PRODUCTION'
          ? 'production'
          : 'sandbox',
      subtotalCents: sale.quote.subtotalCents,
      options: options.map((option) => ({
        installments: option.installments,
        installmentValueCents: option.installmentValueCents,
        totalCents: option.totalCents,
      })),
    };
  }

  /** Creates the card order and sends its first charge. */
  async createOrder(slug: string, dto: CheckoutCardOrderDto, now = new Date()) {
    const existing = await this.prisma.checkoutOrder.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      include: { product: { select: { slug: true } } },
    });
    if (existing) {
      if (existing.product.slug !== slug || existing.paymentMethod !== 'CARD')
        conflictWith(
          'CHECKOUT_IDEMPOTENCY_REUSED',
          'Este pedido já foi usado para outra compra. Recarregue a página.',
        );
      return this.orders.view(existing.publicToken, now);
    }
    const buyerDocument = normalizeDocument(dto.buyer.document);
    if (!buyerDocument)
      throw new BadRequestException({
        code: 'CHECKOUT_INVALID_BUYER',
        message: 'Confira o CPF ou CNPJ informado.',
      });
    const holderDocument = this.holderDocument(dto.holderDocument);
    await this.assertDocumentLimit(buyerDocument, now);
    const sale = await this.catalog.prepare(slug, dto, now, 'CARD');
    const card = sale.card!;
    const { quote, option } = await this.usableQuote(
      dto.quoteId,
      dto.installments,
      sale.companyId,
      cartFingerprint({ ...sale.quote, productId: sale.productId }),
      card,
      now,
    );
    const bp = cardProcessingBasisPoints(card.rates, option.installments);
    let created: {
      orderId: string;
      token: string;
      attempt: CheckoutCardAttempt;
    };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const order = await tx.checkoutOrder.create({
          data: {
            ...this.orders.orderData(sale, dto, buyerDocument, now),
            paymentMethod: 'CARD',
            installments: option.installments,
            totalCents: option.totalCents,
            surchargeCents: option.totalCents - sale.quote.subtotalCents,
            efiFeeBasisPoints: bp,
            efiFeeCents: option.efiFeeCents,
            feePayer: sale.settings.cardFeePayer,
            platformSettingsId: card.account.settings.id,
          },
        });
        if (dto.sessionKey)
          await markConverted(tx, sale.productId, dto.sessionKey, order.id);
        const attempt = await this.reserve(tx, order.id, sale.companyId, card, {
          quoteId: quote.id,
          brand: quote.brand,
          option,
          idempotencyKey: dto.idempotencyKey,
          requestHash: requestHash(dto),
        });
        return { orderId: order.id, token: order.publicToken, attempt };
      });
    } catch (error) {
      // Two identical requests at once: the second gets the first order.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.prisma.checkoutOrder.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (raced) return this.orders.view(raced.publicToken, now);
      }
      throw error;
    }
    try {
      await this.webhooks.emit(
        this.prisma,
        sale.companyId,
        'order.created',
        created.orderId,
      );
    } catch {
      this.logger.warn('CHECKOUT_ORDER_CREATED_EVENT_FAILED');
    }
    await this.send(card, created.attempt, {
      paymentToken: dto.paymentToken,
      holderDocument,
      address: dto.address,
      description: sale.productName,
    });
    return this.orders.view(created.token, now);
  }

  /** Another try on the same open order, after a decline. */
  async pay(token: string, dto: CheckoutCardPayDto, now = new Date()) {
    const order = await this.prisma.checkoutOrder.findUnique({
      where: { publicToken: token },
      include: {
        cardAttempts: { orderBy: { createdAt: 'desc' } },
        product: { select: { name: true } },
      },
    });
    if (!order || order.paymentMethod !== 'CARD')
      throw new NotFoundException('Pedido não encontrado.');
    const repeated = order.cardAttempts.find(
      (attempt) => attempt.idempotencyKey === dto.idempotencyKey,
    );
    if (repeated) {
      if (repeated.requestHash !== requestHash(dto))
        conflictWith(
          'IDEMPOTENCY_CONFLICT',
          'Esta confirmação já foi usada com outros dados.',
        );
      return this.orders.view(token, now);
    }
    if (order.status !== 'PENDING' || now > order.expiresAt)
      conflictWith(
        'CARD_ORDER_CLOSED',
        'Este pedido foi encerrado. Volte à página do produto para comprar de novo.',
      );
    if (
      order.cardAttempts.some((attempt) =>
        BUSY.includes(attempt.status as (typeof BUSY)[number]),
      )
    )
      conflictWith(
        'CARD_PAYMENT_PROCESSING',
        'Um pagamento já está em análise. Aguarde a confirmação.',
      );
    if (order.cardAttempts.length >= CARD_ATTEMPTS_PER_ORDER)
      conflictWith(
        'CARD_ATTEMPT_LIMIT',
        'Não foi possível pagar com cartão. Pague com Pix.',
      );
    const holderDocument = this.holderDocument(dto.holderDocument);
    await this.assertDocumentLimit(order.buyerDocument, now);
    const card = await this.cardFor(order.companyId);
    const { quote, option } = await this.usableQuote(
      dto.quoteId,
      dto.installments,
      order.companyId,
      cartFingerprint({
        productId: order.productId,
        items: order.items as unknown as OrderItem[],
        couponId: order.couponId,
        subtotalCents: order.subtotalCents,
      }),
      card,
      now,
    );
    let attempt: CheckoutCardAttempt;
    try {
      attempt = await this.prisma.$transaction(async (tx) => {
        // One try at a time per order, also across API instances.
        await tx.$queryRaw`SELECT id FROM "CheckoutOrder" WHERE id = ${order.id} FOR UPDATE`;
        const current = await tx.checkoutCardAttempt.findMany({
          where: { orderId: order.id },
          select: { status: true },
        });
        if (
          current.some((row) =>
            BUSY.includes(row.status as (typeof BUSY)[number]),
          )
        )
          conflictWith(
            'CARD_PAYMENT_PROCESSING',
            'Um pagamento já está em análise. Aguarde a confirmação.',
          );
        if (current.length >= CARD_ATTEMPTS_PER_ORDER)
          conflictWith(
            'CARD_ATTEMPT_LIMIT',
            'Não foi possível pagar com cartão. Pague com Pix.',
          );
        await tx.checkoutOrder.update({
          where: { id: order.id },
          data: {
            installments: option.installments,
            totalCents: option.totalCents,
            surchargeCents: option.totalCents - order.subtotalCents,
            efiFeeBasisPoints: cardProcessingBasisPoints(
              card.rates,
              option.installments,
            ),
            efiFeeCents: option.efiFeeCents,
          },
        });
        return this.reserve(tx, order.id, order.companyId, card, {
          quoteId: quote.id,
          brand: quote.brand,
          option,
          idempotencyKey: dto.idempotencyKey,
          requestHash: requestHash(dto),
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        return this.orders.view(token, now);
      throw error;
    }
    await this.send(card, attempt, {
      paymentToken: dto.paymentToken,
      holderDocument,
      address: dto.address,
      description: order.product.name,
    });
    return this.orders.view(token, now);
  }

  /**
   * A notice of the charges webhook for the CifraMais account. The event only
   * says which charge changed; its state is read back from the Efí.
   */
  async handleNotification(
    identityId: string,
    token: string,
  ): Promise<boolean> {
    const account = await this.platform.ready();
    if (!account || account.identity.id !== identityId) {
      await this.anomaly('CHECKOUT_CARD_UNKNOWN_ACCOUNT', identityId);
      return false;
    }
    const event = await this.client.notification(account, token);
    if (!event || (!event.customId && !event.chargeId)) return false;
    const attempt = await this.prisma.checkoutCardAttempt.findFirst({
      where: {
        issuerIdentityId: identityId,
        ...(event.customId
          ? { id: event.customId }
          : { efiChargeId: event.chargeId }),
      },
    });
    if (!attempt) {
      await this.anomaly(
        'CHECKOUT_CARD_UNKNOWN_CHARGE',
        event.customId ?? event.chargeId ?? 'unknown',
      );
      return false;
    }
    await this.reconcile(attempt.id, event.chargeId ?? undefined);
    return true;
  }

  /** Attempts without a final answer: read their state at the Efí. */
  async reconcileDue(now = new Date()): Promise<void> {
    const attempts = await this.prisma.checkoutCardAttempt.findMany({
      where: {
        OR: [
          { status: { in: ['UNCERTAIN', 'APPROVED'] } },
          {
            status: 'SUBMITTING',
            createdAt: { lt: new Date(now.getTime() - 2 * 60_000) },
          },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: 50,
      select: { id: true },
    });
    for (const { id } of attempts) {
      try {
        await this.reconcile(id, undefined, now);
      } catch {
        this.logger.warn('CHECKOUT_CARD_RECONCILE_PENDING');
      }
      // Rotate: an attempt that keeps failing does not block the others.
      await this.prisma.checkoutCardAttempt.updateMany({
        where: { id },
        data: { updatedAt: now },
      });
    }
  }

  /**
   * Open card orders past their 30 minutes with nothing in progress close:
   * declined when a charge was declined (one seller notice), else expired.
   */
  async closeOverdue(now = new Date()): Promise<void> {
    const overdue = await this.prisma.checkoutOrder.findMany({
      where: {
        paymentMethod: 'CARD',
        status: 'PENDING',
        expiresAt: { lt: new Date(now.getTime() - 10 * 60_000) },
        cardAttempts: { none: { status: { in: [...BUSY] } } },
      },
      include: { cardAttempts: { select: { status: true } } },
      take: 50,
    });
    for (const order of overdue) {
      const declined = order.cardAttempts.some(
        (attempt) => attempt.status === 'DECLINED',
      );
      const closed = await this.prisma.checkoutOrder.updateMany({
        where: {
          id: order.id,
          status: 'PENDING',
          cardAttempts: { none: { status: { in: [...BUSY] } } },
        },
        data: { status: declined ? 'DECLINED' : 'EXPIRED' },
      });
      if (closed.count === 1 && declined)
        await this.webhooks.emit(
          this.prisma,
          order.companyId,
          'order.card_declined',
          order.id,
          {},
          now,
        );
    }
  }

  /** Reads one attempt at the Efí and applies what it says. */
  async reconcile(
    attemptId: string,
    providerHint?: string,
    now = new Date(),
  ): Promise<void> {
    const attempt = await this.prisma.checkoutCardAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt) return;
    const account = await this.platform.ready();
    if (!account || account.identity.id !== attempt.issuerIdentityId) return;
    let chargeId = attempt.efiChargeId ?? providerHint ?? null;
    if (!chargeId) {
      const found = await this.client.findByAttempt(
        account,
        attempt.id,
        attempt.createdAt,
        now,
      );
      if (found.length > 1) {
        await this.anomaly('CHECKOUT_CARD_DUPLICATE_CHARGE', attempt.id);
        return;
      }
      if (!found.length) {
        // Long enough without any charge at the Efí: it was never created.
        if (now.getTime() - attempt.createdAt.getTime() > NOT_FOUND_AFTER_MS)
          await this.prisma.checkoutCardAttempt.updateMany({
            where: {
              id: attempt.id,
              status: { in: ['SUBMITTING', 'UNCERTAIN'] },
            },
            data: { status: 'CANCELED', providerStatus: 'not_found' },
          });
        return;
      }
      chargeId = found[0]!;
    }
    const detail = await this.client.detail(account, chargeId);
    if (
      !detail ||
      detail.chargeId !== chargeId ||
      detail.customId !== attempt.id ||
      detail.method !== 'credit_card'
    ) {
      await this.anomaly(
        'CHECKOUT_CARD_DETAIL_MISMATCH',
        attempt.id,
        attempt.companyId,
      );
      return;
    }
    await this.observe(
      attempt,
      chargeId,
      detail.status,
      detail.totalCents,
      detail.installments,
    );
  }

  private async observe(
    attempt: CheckoutCardAttempt,
    chargeId: string,
    status: string,
    totalCents: number | null,
    installments: number | null,
  ): Promise<void> {
    if (
      totalCents !== attempt.totalCents ||
      (installments !== null && installments !== attempt.installments) ||
      (attempt.efiChargeId && attempt.efiChargeId !== chargeId)
    ) {
      await this.prisma.checkoutCardAttempt.updateMany({
        where: { id: attempt.id, status: 'SUBMITTING' },
        data: {
          status: 'UNCERTAIN',
          efiChargeId: attempt.efiChargeId ?? chargeId,
        },
      });
      await this.anomaly(
        'CHECKOUT_CARD_AMOUNT_MISMATCH',
        attempt.id,
        attempt.companyId,
      );
      return;
    }
    const mapped = mapStatus(status);
    if (!mapped) {
      // Refund, contestation or settlement: the admin records it (part 3).
      await this.anomaly(
        `CHECKOUT_CARD_${status.replace(/\W/g, '').toUpperCase().slice(0, 20) || 'UNKNOWN'}_REVIEW`,
        attempt.id,
        attempt.companyId,
      );
      return;
    }
    if (mapped === 'PAID') {
      await this.prisma.checkoutCardAttempt.update({
        where: { id: attempt.id },
        data: { efiChargeId: chargeId, providerStatus: status },
      });
      const paidOrder = await this.prisma.checkoutOrder.findFirst({
        where: {
          id: attempt.orderId,
          status: { not: 'PENDING' },
          cardAttempts: { some: { status: 'PAID', id: { not: attempt.id } } },
        },
        select: { id: true },
      });
      // Two charges paid for one order: the second one is for the admin.
      if (paidOrder) {
        await this.anomaly(
          'CHECKOUT_CARD_DOUBLE_PAYMENT',
          attempt.id,
          attempt.companyId,
        );
        return;
      }
      await this.payments.confirmCard(attempt.id);
      return;
    }
    // A late answer never undoes an approval or a payment.
    const from: CheckoutCardAttempt['status'][] =
      mapped === 'APPROVED'
        ? ['SUBMITTING', 'UNCERTAIN']
        : ['SUBMITTING', 'UNCERTAIN', 'APPROVED'];
    await this.prisma.checkoutCardAttempt.updateMany({
      where: { id: attempt.id, status: { in: from } },
      data: { status: mapped, efiChargeId: chargeId, providerStatus: status },
    });
  }

  /** Sends the charge once. A lost answer leaves the attempt uncertain. */
  private async send(
    card: CheckoutCardAccount,
    attempt: CheckoutCardAttempt,
    input: {
      paymentToken: string;
      holderDocument: string;
      address: CheckoutCardAddress;
      description: string;
    },
  ): Promise<void> {
    const order = await this.prisma.checkoutOrder.findUniqueOrThrow({
      where: { id: attempt.orderId },
      select: {
        buyerName: true,
        buyerEmail: true,
        buyerPhone: true,
        buyerDocument: true,
      },
    });
    try {
      const response = await this.client.submit(card.account, {
        attemptId: attempt.id,
        description: input.description,
        submissionCents: attempt.submissionCents,
        installments: attempt.installments,
        paymentToken: input.paymentToken,
        customer: {
          name: order.buyerName,
          cpf: input.holderDocument,
          email: order.buyerEmail,
          phone_number: order.buyerPhone,
          ...(order.buyerDocument.length === 14
            ? {
                juridical_person: {
                  corporate_name: order.buyerName,
                  cnpj: order.buyerDocument,
                },
              }
            : {}),
        },
        address: {
          ...input.address,
          zipcode: input.address.zipcode.replace(/\D/g, ''),
          state: input.address.state.toUpperCase(),
        },
      });
      await this.observe(
        attempt,
        response.chargeId,
        response.status,
        response.totalCents,
        response.installments ?? null,
      );
    } catch {
      // The Efí may have charged: reconciled later by custom_id, never resent.
      await this.prisma.checkoutCardAttempt.updateMany({
        where: { id: attempt.id, status: 'SUBMITTING' },
        data: { status: 'UNCERTAIN' },
      });
    }
  }

  private reserve(
    tx: Prisma.TransactionClient,
    orderId: string,
    companyId: string,
    card: CheckoutCardAccount,
    input: {
      quoteId: string;
      brand: string;
      option: CardOption;
      idempotencyKey: string;
      requestHash: string;
    },
  ): Promise<CheckoutCardAttempt> {
    return tx.checkoutCardAttempt.create({
      data: {
        id: randomUUID(),
        orderId,
        companyId,
        issuerIdentityId: card.account.identity.id,
        quoteId: input.quoteId,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        brand: input.brand,
        installments: input.option.installments,
        submissionCents: input.option.submissionCents,
        totalCents: input.option.totalCents,
        efiFeeCents: input.option.efiFeeCents,
      },
    });
  }

  /**
   * Buyer pays the cost: the tariff is grossed up on the Efí total. Seller
   * pays: the buyer pays the Efí total, and the seller's cost is what it adds
   * to P plus the tariff on it.
   */
  private async price(
    sale: SaleContext,
    card: CheckoutCardAccount,
    brand: CheckoutCardBrand,
  ): Promise<CardOption[]> {
    const debt = sale.quote.subtotalCents;
    const counts = (
      await this.client.installmentCounts(card.account, debt, brand)
    ).filter((count) => count <= sale.settings.maxInstallments);
    const options: CardOption[] = [];
    for (const installments of counts) {
      const bp = cardProcessingBasisPoints(card.rates, installments);
      const valueFor = async (submission: number) => {
        const value = await this.client.installmentValue(
          card.account,
          submission,
          brand,
          installments,
        );
        if (value === null)
          conflictWith(
            'CARD_INSTALLMENT_UNAVAILABLE',
            'Parcelamento indisponível para este valor.',
          );
        return value;
      };
      if (sale.settings.cardFeePayer === 'BUYER') {
        const quoted = await grossUpCard(debt, installments, bp, 0, valueFor);
        options.push(quoted);
      } else {
        const installmentValueCents = await valueFor(debt);
        const totalCents = installmentValueCents * installments;
        options.push({
          installments,
          installmentValueCents,
          submissionCents: debt,
          totalCents,
          efiFeeCents:
            totalCents - debt + Math.round((totalCents * bp) / 10_000),
        });
      }
    }
    if (!options.length)
      conflictWith(
        'CARD_INSTALLMENT_UNAVAILABLE',
        'Não há parcelas disponíveis para este cartão. Pague com Pix.',
      );
    return options;
  }

  private async usableQuote(
    quoteId: string,
    installments: number,
    companyId: string,
    fingerprint: string,
    card: CheckoutCardAccount,
    now: Date,
  ) {
    const quote = await this.prisma.checkoutCardQuote.findFirst({
      where: { id: quoteId, companyId },
    });
    if (
      !quote ||
      quote.validUntil <= now ||
      quote.fingerprint !== fingerprint ||
      quote.platformSettingsId !== card.account.settings.id
    )
      conflictWith(
        'CARD_QUOTE_EXPIRED',
        'Os valores foram atualizados. Confira as parcelas de novo.',
      );
    const option = (quote.options as unknown as CardOption[]).find(
      (candidate) => candidate.installments === installments,
    );
    if (!option)
      throw new BadRequestException({
        code: 'CARD_INSTALLMENT_UNAVAILABLE',
        message: 'Parcelamento indisponível.',
      });
    return { quote, option };
  }

  private async cardFor(companyId: string): Promise<CheckoutCardAccount> {
    const [card, settings] = await Promise.all([
      this.platform.cardReady(),
      this.prisma.checkoutSettings.findUnique({ where: { companyId } }),
    ]);
    if (!card || !settings?.cardEnabled || settings.cardPausedAt)
      conflictWith(
        'CARD_NOT_AVAILABLE',
        'O cartão está indisponível no momento. Pague com Pix.',
      );
    return card;
  }

  private holderDocument(value: string): string {
    const document = normalizeDocument(value);
    if (!document || document.length !== 11)
      throw new BadRequestException({
        code: 'CARD_INVALID_HOLDER',
        message: 'Confira o CPF do titular do cartão.',
      });
    return document;
  }

  private async assertDocumentLimit(document: string, now: Date) {
    const recent = await this.prisma.checkoutCardAttempt.count({
      where: {
        order: { buyerDocument: document },
        createdAt: { gte: new Date(now.getTime() - 86_400_000) },
      },
    });
    if (recent >= CARD_ATTEMPTS_PER_DOCUMENT)
      conflictWith(
        'CARD_ATTEMPT_LIMIT',
        'Não foi possível pagar com cartão. Pague com Pix.',
      );
  }

  private async anomaly(
    reasonCode: string,
    reference: string,
    companyId?: string,
  ): Promise<void> {
    try {
      await this.prisma.paymentWebhookAnomaly.upsert({
        where: {
          source_externalReference_reasonCode: {
            source: ANOMALY_SOURCE,
            externalReference: reference.slice(0, 128) || 'unknown',
            reasonCode,
          },
        },
        create: {
          source: ANOMALY_SOURCE,
          reasonCode,
          externalReference: reference.slice(0, 128) || 'unknown',
          companyId: companyId ?? null,
        },
        update: { occurrences: { increment: 1 }, lastSeenAt: new Date() },
      });
    } catch {
      this.logger.error('CHECKOUT_CARD_ANOMALY_NOT_RECORDED');
    }
  }
}
