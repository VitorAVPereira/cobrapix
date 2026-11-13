import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CheckoutOrder, CheckoutPaymentAttempt, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CheckoutCatalogService,
  type SaleContext,
} from './checkout-catalog.service';
import { CheckoutPlatformService } from './checkout-platform.service';
import { itemShares, type OrderItem } from './checkout-pricing';
import {
  brandFields,
  conflict,
  normalizeDocument,
  offerTokenOf,
  pageBrand,
} from './checkout-rules';
import { EfiCheckoutPixClient } from './efi-checkout-pix.client';
import { CheckoutPaymentsService } from './checkout-payments.service';
import { CheckoutWebhooksService } from './checkout-webhooks.service';
import { markConverted } from './checkout-recovery.service';
import { CreateCheckoutOrderDto } from './dto/checkout-public.dto';

export const PIX_VALIDITY_MS = 30 * 60_000;
// Against testing stolen cards: tries per order, then the page offers Pix.
export const CARD_ATTEMPTS_PER_ORDER = 3;
const TXID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** "ckt" + 29 random characters: 32 in all, inside the Efí 26–35 range. */
export function checkoutTxid(): string {
  return `ckt${Array.from(randomBytes(29), (byte) => TXID_ALPHABET[byte % 36]).join('')}`;
}

/** The seller's own offer page receives the one-click key as `cifra_oferta`. */
export function withOfferParam(pageUrl: string, offerToken: string): string {
  const url = new URL(pageUrl);
  url.searchParams.set('cifra_oferta', offerToken);
  return url.toString();
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

type OrderWithAttempt = CheckoutOrder & {
  attempt: CheckoutPaymentAttempt | null;
  product: { slug: string };
};

/** The buyer data an order is created with (Pix or card). */
export interface OrderBuyerInput {
  buyer: { name: string; email: string; phone: string };
  utm?: object | null;
  idempotencyKey: string;
}

@Injectable()
export class CheckoutOrdersService {
  private readonly logger = new Logger(CheckoutOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CheckoutCatalogService,
    private readonly platform: CheckoutPlatformService,
    private readonly pix: EfiCheckoutPixClient,
    private readonly payments: CheckoutPaymentsService,
    private readonly webhooks: CheckoutWebhooksService,
  ) {}

  async create(slug: string, dto: CreateCheckoutOrderDto, now = new Date()) {
    const existing = await this.byIdempotencyKey(dto.idempotencyKey);
    if (existing) return this.sameRequest(existing, slug);

    const buyerDocument = normalizeDocument(dto.buyer.document);
    if (!buyerDocument)
      throw new BadRequestException({
        code: 'CHECKOUT_INVALID_BUYER',
        message: 'Confira o CPF ou CNPJ informado.',
      });
    const sale = await this.catalog.prepare(slug, dto, now);
    try {
      return await this.createPix(sale, dto, buyerDocument, now, {
        after: (tx, id) =>
          dto.sessionKey
            ? markConverted(tx, sale.productId, dto.sessionKey, id)
            : Promise.resolve(),
      });
    } catch (error) {
      // Two identical requests at once: the second one gets the first order.
      if (isUniqueViolation(error)) {
        const raced = await this.byIdempotencyKey(dto.idempotencyKey);
        if (raced) return this.sameRequest(raced, slug);
      }
      throw error;
    }
  }

  /**
   * Creates the order and its Pix. The hooks run in the order transaction
   * (offer answer before, lead conversion after); a duplicate key is left
   * to the caller.
   */
  async createPix(
    sale: SaleContext & { productId: string; productName: string },
    dto: OrderBuyerInput,
    buyerDocument: string,
    now: Date,
    hooks: {
      extra?: Partial<Prisma.CheckoutOrderUncheckedCreateInput>;
      before?: (tx: Prisma.TransactionClient) => Promise<unknown>;
      after?: (
        tx: Prisma.TransactionClient,
        orderId: string,
      ) => Promise<unknown>;
    },
  ) {
    const txid = checkoutTxid();
    const order: CheckoutOrder = await this.prisma.$transaction(async (tx) => {
      await hooks.before?.(tx);
      const created = await tx.checkoutOrder.create({
        data: {
          ...this.orderData(sale, dto, buyerDocument, now),
          ...hooks.extra,
        },
      });
      await hooks.after?.(tx, created.id);
      await tx.checkoutPaymentAttempt.create({
        data: {
          orderId: created.id,
          companyId: sale.companyId,
          issuerIdentityId: sale.platform.identity.id,
          efiTxid: txid,
          amountCents: sale.quote.totalCents,
        },
      });
      return created;
    });

    // Outside the transaction: the Pix is created once, and a lost answer is
    // checked later by txid instead of being sent again.
    const created = await this.pix.create(sale.platform, {
      txid,
      amountCents: sale.quote.totalCents,
      buyerName: order.buyerName,
      buyerDocument: order.buyerDocument,
      pixKey: sale.platform.identity.pixKey,
      description: `${sale.productName} — ${sale.settings.displayName} via Cifra+`,
    });
    if (created.outcome === 'CREATED')
      await this.prisma.checkoutPaymentAttempt.updateMany({
        where: { orderId: order.id, status: 'CREATING' },
        data: {
          status: 'ACTIVE',
          pixCopyPaste: created.pixCopyPaste,
          pixQrCodeImage: created.qrCodeImage,
        },
      });
    else if (created.outcome === 'REJECTED') {
      this.logger.warn(`CHECKOUT_PIX_REJECTED ${created.code}`);
      const attempt =
        await this.prisma.checkoutPaymentAttempt.findUniqueOrThrow({
          where: { orderId: order.id },
          select: { id: true },
        });
      await this.fail(attempt.id, order.id, 'CREATING');
    } else
      await this.prisma.checkoutPaymentAttempt.updateMany({
        where: { orderId: order.id, status: 'CREATING' },
        data: { status: 'UNCERTAIN' },
      });
    try {
      await this.webhooks.emit(
        this.prisma,
        sale.companyId,
        'order.created',
        order.id,
      );
    } catch {
      // The order and its Pix stand; only the seller notice is missing.
      this.logger.warn('CHECKOUT_ORDER_CREATED_EVENT_FAILED');
    }
    return this.view(order.publicToken, now);
  }

  /** The order row as sold: items and amounts copied, valid for 30 minutes. */
  orderData(
    sale: SaleContext & { productId: string },
    dto: OrderBuyerInput,
    buyerDocument: string,
    now: Date,
  ): Prisma.CheckoutOrderUncheckedCreateInput {
    return {
      companyId: sale.companyId,
      productId: sale.productId,
      publicToken: randomBytes(32).toString('base64url'),
      idempotencyKey: dto.idempotencyKey,
      buyerName: dto.buyer.name.trim(),
      buyerEmail: dto.buyer.email.trim().toLowerCase(),
      buyerDocument,
      buyerPhone: dto.buyer.phone,
      items: sale.quote.items as unknown as Prisma.InputJsonValue,
      couponId: sale.quote.couponId,
      couponCode: sale.quote.couponCode,
      subtotalCents: sale.quote.subtotalCents,
      discountCents: sale.quote.discountCents,
      surchargeCents: sale.quote.surchargeCents,
      totalCents: sale.quote.totalCents,
      efiFeeBasisPoints: sale.quote.efiFeeBasisPoints,
      efiFeeCents: sale.quote.efiFeeCents,
      platformFeeBasisPoints: sale.quote.platformFeeBasisPoints,
      platformFeeCents: sale.quote.platformFeeCents,
      feePayer: sale.quote.feePayer,
      termsId: sale.terms.id,
      platformSettingsId: sale.platform.settings.id,
      utm: dto.utm
        ? (dto.utm as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      expiresAt: new Date(now.getTime() + PIX_VALIDITY_MS),
    };
  }

  /** The buyer's view of one order: the token is the only key. */
  async view(token: string, now = new Date()) {
    const order = await this.prisma.checkoutOrder.findUnique({
      where: { publicToken: token },
      include: {
        attempt: true,
        product: {
          select: {
            slug: true,
            afterPurchase: true,
            afterPurchaseUrl: true,
            ...brandFields,
          },
        },
        cardAttempts: {
          orderBy: { createdAt: 'desc' },
          select: { status: true },
        },
        parent: { select: { publicToken: true, offerExpiresAt: true } },
        refundRequests: {
          where: { status: { in: ['REQUESTED', 'DONE'] } },
          orderBy: { createdAt: 'desc' },
          select: {
            status: true,
            itemIndexes: true,
            amountCents: true,
            holdUntil: true,
            createdAt: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    const settings = await this.prisma.checkoutSettings.findUnique({
      where: { companyId: order.companyId },
    });
    const brand = settings && {
      ...settings,
      ...pageBrand(settings, order.product),
    };
    const items = order.items as unknown as OrderItem[];
    const lastCard = order.cardAttempts[0]?.status;
    const cardBusy =
      lastCard === 'SUBMITTING' ||
      lastCard === 'APPROVED' ||
      lastCard === 'UNCERTAIN';
    const cardDeclined = order.cardAttempts.some(
      (attempt) => attempt.status === 'DECLINED',
    );
    const status =
      order.status === 'PENDING' && now > order.expiresAt && !cardBusy
        ? cardDeclined
          ? 'DECLINED'
          : 'EXPIRED'
        : order.status;
    const attempt = order.attempt;
    const paid = status === 'PAID';
    const main = items.find((line) => line.kind === 'MAIN');
    const accessUrl =
      paid && main && main.deliveryMode !== 'WEBHOOK' ? main.accessUrl : null;
    // A purchase with an open offer window goes to the offer, not the access.
    const offerOpen =
      paid && order.offerExpiresAt !== null && now <= order.offerExpiresAt;
    const offerToken = offerOpen ? offerTokenOf(order.publicToken) : null;
    const offerUrl =
      offerToken && order.product.afterPurchase === 'OFFER'
        ? `/c/oferta/${offerToken}`
        : offerToken &&
            order.product.afterPurchase === 'EXTERNAL' &&
            order.product.afterPurchaseUrl
          ? withOfferParam(order.product.afterPurchaseUrl, offerToken)
          : null;
    const parent = order.parent;
    const shares = itemShares(items, order.totalCents);
    const openRefund = order.refundRequests.find(
      (request) => request.status === 'REQUESTED',
    );
    return {
      token: order.publicToken,
      productSlug: order.product.slug,
      status,
      paymentMethod: order.paymentMethod,
      installments: order.installments,
      processing:
        status === 'PENDING' &&
        (attempt?.status === 'CREATING' ||
          attempt?.status === 'UNCERTAIN' ||
          cardBusy),
      card:
        order.paymentMethod === 'CARD'
          ? {
              declined: lastCard === 'DECLINED' || lastCard === 'CANCELED',
              // Another try on the same order, while it is open.
              canRetry:
                status === 'PENDING' &&
                !cardBusy &&
                order.cardAttempts.length < CARD_ATTEMPTS_PER_ORDER,
            }
          : null,
      expiresAt: order.expiresAt,
      items: items.map((line, index) => ({
        kind: line.kind,
        name: line.name,
        unitPriceCents: line.unitPriceCents,
        discountCents: line.discountCents,
        // What this item returns if refunded alone (surcharge included).
        refundCents: shares[index] ?? 0,
        // Access only after the payment is confirmed.
        accessUrl:
          paid && line.deliveryMode !== 'WEBHOOK' ? line.accessUrl : null,
        accessInstructions: paid ? line.accessInstructions : null,
      })),
      subtotalCents: order.subtotalCents,
      discountCents: order.discountCents,
      surchargeCents: order.surchargeCents,
      totalCents: order.totalCents,
      pix:
        status === 'PENDING' && attempt?.status === 'ACTIVE'
          ? {
              copyPaste: attempt.pixCopyPaste,
              qrCodeImage: attempt.pixQrCodeImage,
            }
          : null,
      redirectUrl: offerUrl ?? accessUrl,
      redirectKind: offerUrl ? ('OFFER' as const) : ('ACCESS' as const),
      // An offer order goes back to its offer page (e.g. Pix after a decline).
      refund: {
        open: openRefund
          ? {
              itemIndexes: openRefund.itemIndexes,
              amountCents: openRefund.amountCents,
              holdUntil: openRefund.holdUntil,
              createdAt: openRefund.createdAt,
            }
          : null,
        refundedItemIndexes: order.refundRequests.flatMap((request) =>
          request.status === 'DONE' ? request.itemIndexes : [],
        ),
      },
      offerPage:
        parent?.offerExpiresAt && now <= parent.offerExpiresAt
          ? `/c/oferta/${offerTokenOf(parent.publicToken)}`
          : null,
      page: brand
        ? {
            displayName: brand.displayName,
            primaryColor: brand.primaryColor,
            logoUrl: brand.logoAssetId
              ? `/checkout/public/assets/${brand.logoAssetId}`
              : null,
            supportEmail: brand.supportEmail,
            supportWhatsapp: brand.supportWhatsapp,
          }
        : null,
    };
  }

  /**
   * Lost answers at creation: the Pix exists and is active, was already
   * paid, or never existed (then the order fails; nothing was charged).
   */
  async reconcileUncertain(now = new Date()): Promise<void> {
    const platform = await this.platform.ready();
    if (!platform) return;
    const attempts = await this.prisma.checkoutPaymentAttempt.findMany({
      where: { status: 'UNCERTAIN' },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    for (const attempt of attempts) {
      const found = await this.pix.status(platform, attempt.efiTxid);
      await this.prisma.checkoutPaymentAttempt.update({
        where: { id: attempt.id },
        data: { lastCheckedAt: now },
      });
      if (found?.status === 'CONCLUIDA')
        await this.payments.confirm(attempt.id, {
          paidAmountCents: found.paidAmountCents,
          endToEndId: found.endToEndId,
          providerFeeCents: null,
        });
      else if (found)
        await this.prisma.checkoutPaymentAttempt.updateMany({
          where: { id: attempt.id, status: 'UNCERTAIN' },
          data: { status: 'ACTIVE' },
        });
      else if (now.getTime() - attempt.createdAt.getTime() > 10 * 60_000)
        await this.fail(attempt.id, attempt.orderId, 'UNCERTAIN');
    }
  }

  /**
   * Pending orders well past the Pix validity. The Efí is asked first: a
   * payment whose webhook was lost is confirmed instead of expired.
   */
  async expireOverdue(now = new Date()): Promise<void> {
    const platform = await this.platform.ready();
    if (!platform) return;
    const overdue = await this.prisma.checkoutOrder.findMany({
      where: {
        status: 'PENDING',
        expiresAt: { lt: new Date(now.getTime() - 10 * 60_000) },
        attempt: { status: 'ACTIVE' },
      },
      include: { attempt: true },
      orderBy: { expiresAt: 'asc' },
      take: 50,
    });
    for (const order of overdue) {
      const attempt = order.attempt;
      if (!attempt) continue;
      const found = await this.pix.status(platform, attempt.efiTxid);
      if (found?.status === 'CONCLUIDA') {
        await this.payments.confirm(attempt.id, {
          paidAmountCents: found.paidAmountCents,
          endToEndId: found.endToEndId,
          providerFeeCents: null,
        });
        continue;
      }
      const [, expired] = await this.prisma.$transaction([
        this.prisma.checkoutPaymentAttempt.updateMany({
          where: { id: attempt.id, status: 'ACTIVE' },
          data: { status: 'EXPIRED', lastCheckedAt: now },
        }),
        this.prisma.checkoutOrder.updateMany({
          where: { id: order.id, status: 'PENDING' },
          data: { status: 'EXPIRED' },
        }),
      ]);
      // The seller's own recovery starts here.
      if (expired.count === 1)
        await this.webhooks.emit(
          this.prisma,
          order.companyId,
          'order.pix_expired',
          order.id,
        );
    }
  }

  private async fail(
    attemptId: string,
    orderId: string,
    from: 'CREATING' | 'UNCERTAIN',
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.checkoutPaymentAttempt.updateMany({
        where: { id: attemptId, status: from },
        data: { status: 'FAILED' },
      }),
      this.prisma.checkoutOrder.updateMany({
        where: { id: orderId, status: 'PENDING' },
        data: { status: 'FAILED' },
      }),
    ]);
  }

  private byIdempotencyKey(key: string): Promise<OrderWithAttempt | null> {
    return this.prisma.checkoutOrder.findUnique({
      where: { idempotencyKey: key },
      include: { attempt: true, product: { select: { slug: true } } },
    });
  }

  private sameRequest(order: OrderWithAttempt, slug: string) {
    if (order.product.slug !== slug)
      conflict(
        'CHECKOUT_IDEMPOTENCY_REUSED',
        'Este pedido já foi usado para outro produto. Recarregue a página.',
      );
    return this.view(order.publicToken);
  }
}
