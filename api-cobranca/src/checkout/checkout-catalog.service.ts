import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CheckoutSellerTerms, CheckoutSettings } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CheckoutPlatformService,
  type CheckoutCardAccount,
  type CheckoutPlatformAccount,
} from './checkout-platform.service';
import {
  couponIssue,
  quoteOrder,
  type OrderQuote,
  type PricedCoupon,
} from './checkout-pricing';
import { CheckoutQuoteDto } from './dto/checkout-public.dto';

const assetUrl = (id: string | null) =>
  id ? `/checkout/public/assets/${id}` : null;

const productFields = {
  id: true,
  name: true,
  description: true,
  priceCents: true,
  compareAtPriceCents: true,
  imageAssetId: true,
  accessPeriodMonths: true,
  deliveryMode: true,
  accessUrl: true,
  accessInstructions: true,
  active: true,
} as const;

/** Everything an order needs, loaded once and checked together. */
export interface SaleContext {
  companyId: string;
  settings: CheckoutSettings;
  terms: CheckoutSellerTerms;
  platform: CheckoutPlatformAccount;
  quote: OrderQuote;
  // Present only for a card sale.
  card: CheckoutCardAccount | null;
}

/** Card sells when the CifraMais account, the seller and the admin all allow it. */
function cardOn(
  settings: CheckoutSettings,
  card: CheckoutCardAccount | null,
): card is CheckoutCardAccount {
  return Boolean(card && settings.cardEnabled && !settings.cardPausedAt);
}

@Injectable()
export class CheckoutCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: CheckoutPlatformService,
  ) {}

  /** The payment page. Only what a buyer may see: no access link, terms or account. */
  async view(slug: string) {
    const { product, settings, terms } = await this.load(slug);
    const platform = await this.platform.ready();
    const card = cardOn(settings, await this.platform.cardReady());
    const available = Boolean(
      platform && terms && (settings.pixEnabled || card),
    );
    return {
      available,
      unavailableMessage: available
        ? null
        : 'Pagamento indisponível no momento. Fale com o vendedor.',
      product: {
        slug,
        name: product.name,
        description: product.description,
        priceCents: product.priceCents,
        compareAtPriceCents: product.compareAtPriceCents,
        imageUrl: assetUrl(product.imageAssetId),
        accessPeriodMonths: product.accessPeriodMonths,
      },
      bumps: product.bumps.map((bump) => ({
        id: bump.id,
        name: bump.offeredProduct.name,
        headline: bump.headline,
        description: bump.description ?? bump.offeredProduct.description,
        priceCents: bump.priceCents,
        compareAtPriceCents: bump.compareAtPriceCents,
        imageUrl: assetUrl(bump.offeredProduct.imageAssetId),
        accessPeriodMonths: bump.offeredProduct.accessPeriodMonths,
      })),
      page: {
        displayName: settings.displayName,
        logoUrl: assetUrl(settings.logoAssetId),
        bannerUrl: assetUrl(settings.bannerAssetId),
        primaryColor: settings.primaryColor,
        supportEmail: settings.supportEmail,
        supportWhatsapp: settings.supportWhatsapp,
        whatsappButtonPhone: settings.whatsappButtonPhone,
      },
      payment: {
        pixEnabled: settings.pixEnabled,
        cardEnabled: card,
        maxInstallments: card ? settings.maxInstallments : null,
      },
    };
  }

  async quote(slug: string, dto: CheckoutQuoteDto) {
    const { quote } = await this.prepare(slug, dto, new Date());
    return {
      items: quote.items.map((line) => ({
        kind: line.kind,
        name: line.name,
        unitPriceCents: line.unitPriceCents,
        discountCents: line.discountCents,
      })),
      couponCode: quote.couponCode,
      discountCents: quote.discountCents,
      subtotalCents: quote.subtotalCents,
      surchargeCents: quote.surchargeCents,
      totalCents: quote.totalCents,
    };
  }

  /** Validates the choice and prices it with the current account and terms. */
  async prepare(
    slug: string,
    dto: Pick<CheckoutQuoteDto, 'bumpIds' | 'couponCode'>,
    now: Date,
    method: 'PIX' | 'CARD' = 'PIX',
  ): Promise<SaleContext & { productId: string; productName: string }> {
    const { product, settings, terms, companyId } = await this.load(slug);
    const platform = await this.platform.ready();
    if (!platform || !terms)
      throw this.invalid(
        'CHECKOUT_UNAVAILABLE',
        'Pagamento indisponível no momento. Fale com o vendedor.',
      );
    const cardAccount =
      method === 'CARD' ? await this.platform.cardReady() : null;
    if (
      method === 'PIX' ? !settings.pixEnabled : !cardOn(settings, cardAccount)
    )
      throw this.invalid(
        method === 'PIX' ? 'CHECKOUT_UNAVAILABLE' : 'CARD_NOT_AVAILABLE',
        method === 'PIX'
          ? 'Pagamento indisponível no momento. Fale com o vendedor.'
          : 'O cartão está indisponível no momento. Pague com Pix.',
      );
    const bumps = dto.bumpIds.map((id) => {
      const bump = product.bumps.find((candidate) => candidate.id === id);
      if (!bump)
        throw this.invalid(
          'CHECKOUT_BUMP_UNAVAILABLE',
          'Uma das ofertas não está mais disponível. Recarregue a página.',
        );
      return bump;
    });
    let coupon: PricedCoupon | null = null;
    const code = dto.couponCode?.trim().toUpperCase();
    if (code) {
      const found = await this.prisma.checkoutCoupon.findUnique({
        where: { companyId_code: { companyId, code } },
        include: { products: { select: { productId: true } } },
      });
      const priced = found
        ? { ...found, productIds: found.products.map((link) => link.productId) }
        : null;
      const issue = couponIssue(priced, product.id, now);
      if (issue) throw this.invalid('CHECKOUT_COUPON_INVALID', issue);
      coupon = priced;
    }
    return {
      companyId,
      productId: product.id,
      productName: product.name,
      settings,
      terms,
      platform,
      card: cardAccount,
      // Card: P only here; the installment total comes from the card quote.
      quote: quoteOrder({
        product,
        bumps,
        coupon,
        feePayer: method === 'PIX' ? settings.pixFeePayer : 'SELLER',
        efiFeeBasisPoints:
          method === 'PIX' ? platform.settings.pixFeeBasisPoints : 0,
        platformFeeBasisPoints: terms.platformFeeBasisPoints,
      }),
    };
  }

  private async load(slug: string) {
    const product = await this.prisma.checkoutProduct.findFirst({
      where: {
        slug,
        active: true,
        company: { product: 'CHECKOUT', status: 'ACTIVE' },
      },
      select: {
        ...productFields,
        companyId: true,
        bumps: {
          where: { active: true, offeredProduct: { active: true } },
          orderBy: { position: 'asc' },
          select: {
            id: true,
            priceCents: true,
            compareAtPriceCents: true,
            headline: true,
            description: true,
            offeredProduct: { select: productFields },
          },
        },
      },
    });
    if (!product) throw new NotFoundException('Produto não encontrado.');
    const [settings, terms] = await Promise.all([
      this.prisma.checkoutSettings.findUnique({
        where: { companyId: product.companyId },
      }),
      this.prisma.checkoutSellerTerms.findFirst({
        where: { companyId: product.companyId },
        orderBy: { version: 'desc' },
      }),
    ]);
    if (!settings) throw new NotFoundException('Produto não encontrado.');
    return { product, settings, terms, companyId: product.companyId };
  }

  private invalid(code: string, message: string) {
    return new BadRequestException({ code, message });
  }
}
