import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CheckoutOrder, CheckoutPaymentAttempt, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutCatalogService } from './checkout-catalog.service';
import { CheckoutPlatformService } from './checkout-platform.service';
import type { OrderItem } from './checkout-pricing';
import { conflict, normalizeDocument } from './checkout-rules';
import { EfiCheckoutPixClient } from './efi-checkout-pix.client';
import { CheckoutPaymentsService } from './checkout-payments.service';
import { CreateCheckoutOrderDto } from './dto/checkout-public.dto';

export const PIX_VALIDITY_MS = 30 * 60_000;
const TXID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** "ckt" + 29 random characters: 32 in all, inside the Efí 26–35 range. */
export function checkoutTxid(): string {
  return `ckt${Array.from(randomBytes(29), (byte) => TXID_ALPHABET[byte % 36]).join('')}`;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

type OrderWithAttempt = CheckoutOrder & {
  attempt: CheckoutPaymentAttempt | null;
  product: { slug: string };
};

@Injectable()
export class CheckoutOrdersService {
  private readonly logger = new Logger(CheckoutOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CheckoutCatalogService,
    private readonly platform: CheckoutPlatformService,
    private readonly pix: EfiCheckoutPixClient,
    private readonly payments: CheckoutPaymentsService,
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
    const txid = checkoutTxid();
    let order: CheckoutOrder;
    try {
      order = await this.prisma.$transaction(async (tx) => {
        const created = await tx.checkoutOrder.create({
          data: {
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
          },
        });
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
    } catch (error) {
      // Two identical requests at once: the second one gets the first order.
      if (isUniqueViolation(error)) {
        const raced = await this.byIdempotencyKey(dto.idempotencyKey);
        if (raced) return this.sameRequest(raced, slug);
      }
      throw error;
    }

    // Outside the transaction: the Pix is created once, and a lost answer is
    // checked later by txid instead of being sent again.
    const created = await this.pix.create(sale.platform, {
      txid,
      amountCents: sale.quote.totalCents,
      buyerName: order.buyerName,
      buyerDocument,
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
    return this.view(order.publicToken, now);
  }

  /** The buyer's view of one order: the token is the only key. */
  async view(token: string, now = new Date()) {
    const order = await this.prisma.checkoutOrder.findUnique({
      where: { publicToken: token },
      include: { attempt: true, product: { select: { slug: true } } },
    });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    const settings = await this.prisma.checkoutSettings.findUnique({
      where: { companyId: order.companyId },
    });
    const items = order.items as unknown as OrderItem[];
    const status =
      order.status === 'PENDING' && now > order.expiresAt
        ? 'EXPIRED'
        : order.status;
    const attempt = order.attempt;
    const paid = status === 'PAID';
    const main = items.find((line) => line.kind === 'MAIN');
    return {
      token: order.publicToken,
      productSlug: order.product.slug,
      status,
      processing:
        status === 'PENDING' &&
        (attempt?.status === 'CREATING' || attempt?.status === 'UNCERTAIN'),
      expiresAt: order.expiresAt,
      items: items.map((line) => ({
        kind: line.kind,
        name: line.name,
        unitPriceCents: line.unitPriceCents,
        discountCents: line.discountCents,
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
      redirectUrl:
        paid && main && main.deliveryMode !== 'WEBHOOK' ? main.accessUrl : null,
      page: settings
        ? {
            displayName: settings.displayName,
            primaryColor: settings.primaryColor,
            logoUrl: settings.logoAssetId
              ? `/checkout/public/assets/${settings.logoAssetId}`
              : null,
            supportEmail: settings.supportEmail,
            supportWhatsapp: settings.supportWhatsapp,
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
      await this.prisma.$transaction([
        this.prisma.checkoutPaymentAttempt.updateMany({
          where: { id: attempt.id, status: 'ACTIVE' },
          data: { status: 'EXPIRED', lastCheckedAt: now },
        }),
        this.prisma.checkoutOrder.updateMany({
          where: { id: order.id, status: 'PENDING' },
          data: { status: 'EXPIRED' },
        }),
      ]);
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
