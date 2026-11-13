import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CheckoutCardAttemptStatus,
  CheckoutOrderStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutCatalogService, cardOn } from './checkout-catalog.service';
import { CheckoutPlatformService } from './checkout-platform.service';
import {
  CheckoutOrdersService,
  isUniqueViolation,
} from './checkout-orders.service';
import { CheckoutCardService } from './checkout-card.service';
import type { OrderItem } from './checkout-pricing';
import {
  addMonths,
  brandFields,
  conflict,
  offerTokenHash,
  pageBrand,
} from './checkout-rules';
import type {
  CheckoutOfferAcceptDto,
  CheckoutOfferChoiceDto,
} from './dto/checkout-offer.dto';

const assetUrl = (id: string | null) =>
  id ? `/checkout/public/assets/${id}` : null;

const offerFields = {
  id: true,
  kind: true,
  productId: true,
  priceCents: true,
  compareAtPriceCents: true,
  headline: true,
  description: true,
  offeredProduct: {
    select: {
      id: true,
      name: true,
      description: true,
      imageAssetId: true,
      accessPeriodMonths: true,
    },
  },
} satisfies Prisma.CheckoutOfferSelect;

type Offer = Prisma.CheckoutOfferGetPayload<{ select: typeof offerFields }>;

type Origin = NonNullable<Awaited<ReturnType<CheckoutOffersService['origin']>>>;

type OfferOrder = {
  publicToken: string;
  status: CheckoutOrderStatus;
  paymentMethod: 'PIX' | 'CARD';
  expiresAt: Date;
  cardAttempts: { status: CheckoutCardAttemptStatus }[];
  attempt: { status: string } | null;
};

/**
 * Where the order of an accepted offer stands. BOUGHT and OPEN keep the
 * offer answered; FAILED (Pix not paid, card declined) lets the buyer pay
 * the same offer again with Pix while the window is open.
 */
function orderState(
  order: OfferOrder | null,
  now: Date,
): 'NONE' | 'BOUGHT' | 'OPEN' | 'FAILED' {
  if (!order) return 'NONE';
  if (['PAID', 'REFUNDED', 'CHARGEBACK'].includes(order.status))
    return 'BOUGHT';
  if (order.status !== 'PENDING') return 'FAILED';
  const busy = order.cardAttempts.some((attempt) =>
    ['SUBMITTING', 'APPROVED', 'UNCERTAIN'].includes(attempt.status),
  );
  if (busy) return 'OPEN';
  if (order.paymentMethod === 'CARD')
    return order.cardAttempts.some((attempt) =>
      ['DECLINED', 'CANCELED'].includes(attempt.status),
    )
      ? 'FAILED'
      : 'OPEN';
  return now <= order.expiresAt && order.attempt?.status !== 'FAILED'
    ? 'OPEN'
    : 'FAILED';
}

/** A paid purchase of the product, with access still valid. */
function owns(
  orders: { items: Prisma.JsonValue; paidAt: Date | null }[],
  productId: string,
  now: Date,
): boolean {
  return orders.some(
    (order) =>
      order.paidAt &&
      (order.items as unknown as OrderItem[]).some(
        (line) =>
          line.productId === productId &&
          (!line.accessPeriodMonths ||
            addMonths(order.paidAt!, line.accessPeriodMonths) > now),
      ),
  );
}

/**
 * The one-click offer after a paid purchase. The key is the offer token of
 * the purchase; each offer is answered once, and an accepted offer is an
 * order of its own, tied to the purchase.
 */
@Injectable()
export class CheckoutOffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CheckoutCatalogService,
    private readonly platform: CheckoutPlatformService,
    private readonly orders: CheckoutOrdersService,
    private readonly card: CheckoutCardService,
  ) {}

  /**
   * The offer for this purchase now: the one asked for (seller's page) or,
   * on the Cifra+ page, the upsell and then, if declined, the downsell.
   */
  async view(token: string, offerId?: string, now = new Date()) {
    const origin = await this.origin(token);
    const settings = await this.prisma.checkoutSettings.findUnique({
      where: { companyId: origin.companyId },
    });
    const items = origin.items as unknown as OrderItem[];
    const main = items.find((line) => line.kind === 'MAIN');
    const base = {
      expiresAt: origin.offerExpiresAt,
      // Access stays one click away whatever the buyer does with the offer.
      accessUrl:
        origin.status === 'PAID' && main && main.deliveryMode !== 'WEBHOOK'
          ? main.accessUrl
          : null,
      page: settings
        ? {
            displayName: settings.displayName,
            primaryColor: pageBrand(settings, origin.product).primaryColor,
            logoUrl: assetUrl(pageBrand(settings, origin.product).logoAssetId),
            supportEmail: settings.supportEmail,
            supportWhatsapp: settings.supportWhatsapp,
          }
        : null,
    };
    if (!this.isOpen(origin, now))
      return { ...base, state: 'CLOSED' as const, offer: null, order: null };
    const current = await this.current(origin, offerId, now);
    if (!current)
      return { ...base, state: 'DONE' as const, offer: null, order: null };
    const { offer, order } = current;
    const state = orderState(order, now);
    const [platform, cardAccount, kept] = await Promise.all([
      this.platform.ready(),
      this.platform.cardReady(),
      this.card.keptCard(origin.id),
    ]);
    // The kept card is charged once per offer: after a decline, Pix only.
    const cardUsable =
      Boolean(settings && kept && cardOn(settings, cardAccount)) &&
      !(order?.paymentMethod === 'CARD' && state === 'FAILED');
    return {
      ...base,
      state: 'OFFER' as const,
      offer: {
        id: offer.id,
        kind: offer.kind,
        name: offer.offeredProduct.name,
        headline: offer.headline,
        description: offer.description ?? offer.offeredProduct.description,
        priceCents: offer.priceCents,
        compareAtPriceCents: offer.compareAtPriceCents,
        imageUrl: assetUrl(offer.offeredProduct.imageAssetId),
        accessPeriodMonths: offer.offeredProduct.accessPeriodMonths,
      },
      // An order already started for this offer: the page follows it.
      order:
        order && state === 'OPEN'
          ? { token: order.publicToken, status: order.status }
          : null,
      payment: {
        pixEnabled: Boolean(platform && settings?.pixEnabled),
        card:
          cardUsable && kept && settings
            ? {
                brand: kept.brand,
                maxInstallments: settings.maxInstallments,
              }
            : null,
      },
    };
  }

  /** Installments for the offer on the card kept from the purchase. */
  async cardQuote(
    token: string,
    dto: CheckoutOfferChoiceDto,
    now = new Date(),
  ) {
    const origin = await this.origin(token);
    const { offer } = await this.answerable(origin, dto.offerId, now);
    const kept = await this.card.keptCard(origin.id);
    if (!kept) this.cardUnavailable();
    const sale = await this.catalog.prepareOffer(
      origin.companyId,
      offer.id,
      'CARD',
    );
    const quote = await this.card.quoteFor(sale, kept.brand, now);
    return {
      quoteId: quote.quoteId,
      validUntil: quote.validUntil,
      subtotalCents: quote.subtotalCents,
      options: quote.options,
    };
  }

  /** Accepts the offer: a new order, paid with Pix or the kept card. */
  async accept(token: string, dto: CheckoutOfferAcceptDto, now = new Date()) {
    const repeated = await this.prisma.checkoutOrder.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      select: { publicToken: true, offerId: true, parentOrderId: true },
    });
    const origin = await this.origin(token);
    if (repeated) return this.sameRequest(repeated, origin.id, dto, now);
    const { offer } = await this.answerable(origin, dto.offerId, now);
    const sale = await this.catalog.prepareOffer(
      origin.companyId,
      offer.id,
      dto.method,
    );
    // Locks the purchase so two clicks never create two offer orders.
    const record = async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM "CheckoutOrder" WHERE id = ${origin.id} FOR UPDATE`;
      const latest = await this.latestOrder(tx, origin.id, offer.id);
      const state = orderState(latest, now);
      if (state === 'BOUGHT' || state === 'OPEN')
        conflict(
          'CHECKOUT_OFFER_IN_PROGRESS',
          'Esta oferta já foi aceita. Acompanhe o pagamento.',
        );
      const answer = await tx.checkoutOfferResponse.findUnique({
        where: { orderId_offerId: { orderId: origin.id, offerId: offer.id } },
      });
      if (answer?.decision === 'DECLINED')
        conflict('CHECKOUT_OFFER_ANSWERED', 'Esta oferta já foi recusada.');
      if (!answer)
        await tx.checkoutOfferResponse.create({
          data: {
            orderId: origin.id,
            companyId: origin.companyId,
            offerId: offer.id,
            decision: 'ACCEPTED',
          },
        });
    };
    try {
      if (dto.method === 'PIX')
        return await this.orders.createPix(
          sale,
          {
            buyer: {
              name: origin.buyerName,
              email: origin.buyerEmail,
              phone: origin.buyerPhone,
            },
            utm: origin.utm as object | null,
            idempotencyKey: dto.idempotencyKey,
          },
          origin.buyerDocument,
          now,
          {
            extra: { parentOrderId: origin.id, offerId: offer.id },
            before: record,
          },
        );
      const kept = await this.card.keptCard(origin.id);
      const latest = await this.latestOrder(this.prisma, origin.id, offer.id);
      if (
        !kept ||
        (latest?.paymentMethod === 'CARD' &&
          orderState(latest, now) === 'FAILED')
      )
        this.cardUnavailable();
      if (!dto.quoteId || !dto.installments)
        throw new BadRequestException({
          code: 'CARD_INSTALLMENT_UNAVAILABLE',
          message: 'Escolha as parcelas.',
        });
      return await this.card.createOfferOrder(
        sale,
        origin,
        kept,
        {
          offerId: offer.id,
          quoteId: dto.quoteId,
          installments: dto.installments,
          idempotencyKey: dto.idempotencyKey,
        },
        record,
        now,
      );
    } catch (error) {
      // Two identical requests at once: the second gets the first order.
      if (isUniqueViolation(error)) {
        const raced = await this.prisma.checkoutOrder.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
          select: { publicToken: true, offerId: true, parentOrderId: true },
        });
        if (raced) return this.sameRequest(raced, origin.id, dto, now);
      }
      throw error;
    }
  }

  /** Declines the offer; the page then shows the next one, if any. */
  async decline(token: string, dto: CheckoutOfferChoiceDto, now = new Date()) {
    const origin = await this.origin(token);
    const { offer, order } = await this.answerable(origin, dto.offerId, now);
    const state = orderState(order, now);
    if (state === 'BOUGHT' || state === 'OPEN')
      conflict(
        'CHECKOUT_OFFER_IN_PROGRESS',
        'Esta oferta já foi aceita. Acompanhe o pagamento.',
      );
    // Accepted but not paid (Pix expired, card declined): the buyer gave up.
    await this.prisma.checkoutOfferResponse.upsert({
      where: { orderId_offerId: { orderId: origin.id, offerId: offer.id } },
      create: {
        orderId: origin.id,
        companyId: origin.companyId,
        offerId: offer.id,
        decision: 'DECLINED',
      },
      update: { decision: 'DECLINED' },
    });
    return this.view(token, undefined, now);
  }

  async origin(token: string) {
    const origin = await this.prisma.checkoutOrder.findUnique({
      where: { offerTokenHash: offerTokenHash(token) },
      select: {
        id: true,
        companyId: true,
        productId: true,
        status: true,
        items: true,
        utm: true,
        buyerName: true,
        buyerEmail: true,
        buyerPhone: true,
        buyerDocument: true,
        offerExpiresAt: true,
        product: { select: { afterPurchase: true, ...brandFields } },
        offerResponses: { select: { offerId: true, decision: true } },
      },
    });
    if (!origin) throw new NotFoundException('Oferta não encontrada.');
    return origin;
  }

  private isOpen(origin: Origin, now: Date): boolean {
    return (
      origin.status === 'PAID' &&
      origin.offerExpiresAt !== null &&
      now <= origin.offerExpiresAt
    );
  }

  /** The offer the page shows now, and the order already made for it. */
  private async current(
    origin: Origin,
    offerId: string | undefined,
    now: Date,
  ): Promise<{ offer: Offer; order: OfferOrder | null } | null> {
    const paid = await this.prisma.checkoutOrder.findMany({
      where: {
        companyId: origin.companyId,
        buyerDocument: origin.buyerDocument,
        status: 'PAID',
      },
      orderBy: { paidAt: 'desc' },
      take: 200,
      select: { items: true, paidAt: true },
    });
    const decision = (id: string) =>
      origin.offerResponses.find((answer) => answer.offerId === id)?.decision;
    // Shown unless declined, already bought or owned by the buyer.
    const candidate = async (offer: Offer | null) => {
      if (!offer) return null;
      const order = await this.latestOrder(this.prisma, origin.id, offer.id);
      const state = orderState(order, now);
      if (decision(offer.id) === 'DECLINED' || state === 'BOUGHT') return null;
      if (state === 'NONE' && owns(paid, offer.offeredProduct.id, now))
        return null;
      return { offer, order };
    };
    const active = {
      companyId: origin.companyId,
      active: true,
      offeredProduct: { active: true },
    };
    if (offerId)
      return candidate(
        await this.prisma.checkoutOffer.findFirst({
          where: { ...active, id: offerId },
          select: offerFields,
        }),
      );
    if (origin.product.afterPurchase !== 'OFFER') return null;
    const offers = await this.prisma.checkoutOffer.findMany({
      where: { ...active, productId: origin.productId },
      select: offerFields,
    });
    const upsell = offers.find((offer) => offer.kind === 'UPSELL') ?? null;
    if (!upsell) return null;
    const shown = await candidate(upsell);
    if (shown) return shown;
    // The downsell is for whoever said no to the upsell.
    if (decision(upsell.id) !== 'DECLINED') return null;
    return candidate(offers.find((offer) => offer.kind === 'DOWNSELL') ?? null);
  }

  /** The offer can still be answered by this purchase. */
  private async answerable(origin: Origin, offerId: string, now: Date) {
    if (!this.isOpen(origin, now))
      conflict(
        'CHECKOUT_OFFER_CLOSED',
        'O prazo desta oferta terminou. O acesso à sua compra continua valendo.',
      );
    const current = await this.current(origin, offerId, now);
    if (!current)
      conflict(
        'CHECKOUT_OFFER_UNAVAILABLE',
        'Esta oferta não está mais disponível.',
      );
    return current;
  }

  private latestOrder(
    client: Prisma.TransactionClient | PrismaService,
    originId: string,
    offerId: string,
  ): Promise<OfferOrder | null> {
    return client.checkoutOrder.findFirst({
      where: { parentOrderId: originId, offerId },
      orderBy: { createdAt: 'desc' },
      select: {
        publicToken: true,
        status: true,
        paymentMethod: true,
        expiresAt: true,
        cardAttempts: { select: { status: true } },
        attempt: { select: { status: true } },
      },
    });
  }

  private sameRequest(
    order: {
      publicToken: string;
      offerId: string | null;
      parentOrderId: string | null;
    },
    originId: string,
    dto: CheckoutOfferAcceptDto,
    now: Date,
  ) {
    if (order.parentOrderId !== originId || order.offerId !== dto.offerId)
      conflict(
        'CHECKOUT_IDEMPOTENCY_REUSED',
        'Este pedido já foi usado para outra compra. Recarregue a página.',
      );
    return this.orders.view(order.publicToken, now);
  }

  private cardUnavailable(): never {
    conflict(
      'CARD_NOT_AVAILABLE',
      'Não dá para usar o mesmo cartão nesta oferta. Pague com Pix.',
    );
  }
}
