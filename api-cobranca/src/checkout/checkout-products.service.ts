import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutAssetsService } from './checkout-assets.service';
import {
  assertPrices,
  conflict,
  invalid,
  normalizeAccessUrl,
  productSlug,
  versionChanged,
} from './checkout-rules';
import {
  CheckoutBumpDto,
  CheckoutOfferDto,
  CheckoutProductDto,
  UpdateCheckoutOfferDto,
  ReorderCheckoutBumpsDto,
  SetCheckoutActiveDto,
  UpdateCheckoutBumpDto,
  UpdateCheckoutProductDto,
} from './dto/checkout-product.dto';

export const MAX_ACTIVE_BUMPS = 6;

const bumpView = {
  orderBy: { position: 'asc' },
  include: {
    offeredProduct: {
      select: { id: true, name: true, priceCents: true, active: true },
    },
  },
} satisfies Prisma.CheckoutProduct$bumpsArgs;

const offerView = {
  orderBy: { kind: 'asc' },
  include: {
    offeredProduct: {
      select: { id: true, name: true, priceCents: true, active: true },
    },
  },
} satisfies Prisma.CheckoutProduct$offersArgs;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

@Injectable()
export class CheckoutProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: CheckoutAssetsService,
  ) {}

  list(companyId: string, active?: boolean) {
    return this.prisma.checkoutProduct.findMany({
      where: { companyId, ...(active === undefined ? {} : { active }) },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { bumps: { where: { active: true } } } } },
    });
  }

  async detail(companyId: string, id: string) {
    const product = await this.prisma.checkoutProduct.findFirst({
      where: { id, companyId },
      include: { bumps: bumpView, offers: offerView },
    });
    if (!product) throw new NotFoundException('Produto não encontrado.');
    return product;
  }

  async create(companyId: string, dto: CheckoutProductDto) {
    const data = await this.productData(companyId, dto);
    // The random suffix makes a clash unlikely; retry instead of failing the seller.
    for (let attempt = 0; ; attempt++) {
      try {
        const created = await this.prisma.checkoutProduct.create({
          data: { ...data, companyId, slug: productSlug(dto.name) },
          select: { id: true },
        });
        return this.detail(companyId, created.id);
      } catch (error) {
        if (!isUniqueViolation(error) || attempt === 2) throw error;
      }
    }
  }

  async update(companyId: string, id: string, dto: UpdateCheckoutProductDto) {
    const { expectedVersion, ...fields } = dto;
    const data = await this.productData(companyId, fields);
    const updated = await this.prisma.checkoutProduct.updateMany({
      where: { id, companyId, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (updated.count !== 1) await this.missingOrChanged(companyId, id);
    return this.detail(companyId, id);
  }

  /** Inactive products keep their link and sales; the page stops selling them. */
  async setActive(companyId: string, id: string, dto: SetCheckoutActiveDto) {
    const updated = await this.prisma.checkoutProduct.updateMany({
      where: { id, companyId, version: dto.expectedVersion },
      data: { active: dto.active, version: { increment: 1 } },
    });
    if (updated.count !== 1) await this.missingOrChanged(companyId, id);
    return this.detail(companyId, id);
  }

  async createBump(companyId: string, productId: string, dto: CheckoutBumpDto) {
    await this.detail(companyId, productId);
    await this.assertBump(companyId, productId, dto, null);
    const last = await this.prisma.checkoutOrderBump.findFirst({
      where: { productId, companyId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    try {
      await this.prisma.checkoutOrderBump.create({
        data: {
          ...this.bumpData(dto),
          companyId,
          productId,
          offeredProductId: dto.offeredProductId,
          position: (last?.position ?? 0) + 1,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) this.duplicateBump();
      throw error;
    }
    return this.detail(companyId, productId);
  }

  async updateBump(
    companyId: string,
    productId: string,
    bumpId: string,
    dto: UpdateCheckoutBumpDto,
  ) {
    await this.assertBump(companyId, productId, dto, bumpId);
    try {
      const updated = await this.prisma.checkoutOrderBump.updateMany({
        where: {
          id: bumpId,
          productId,
          companyId,
          version: dto.expectedVersion,
        },
        data: {
          ...this.bumpData(dto),
          offeredProductId: dto.offeredProductId,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        const exists = await this.prisma.checkoutOrderBump.count({
          where: { id: bumpId, productId, companyId },
        });
        if (!exists) throw new NotFoundException('Order bump não encontrado.');
        versionChanged();
      }
    } catch (error) {
      if (isUniqueViolation(error)) this.duplicateBump();
      throw error;
    }
    return this.detail(companyId, productId);
  }

  async removeBump(companyId: string, productId: string, bumpId: string) {
    const removed = await this.prisma.checkoutOrderBump.deleteMany({
      where: { id: bumpId, productId, companyId },
    });
    if (removed.count !== 1)
      throw new NotFoundException('Order bump não encontrado.');
    return this.detail(companyId, productId);
  }

  async createOffer(
    companyId: string,
    productId: string,
    dto: CheckoutOfferDto,
  ) {
    await this.detail(companyId, productId);
    await this.assertOffer(companyId, productId, dto);
    try {
      await this.prisma.checkoutOffer.create({
        data: {
          ...this.offerData(dto),
          companyId,
          productId,
          kind: dto.kind,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) this.duplicateOffer();
      throw error;
    }
    return this.detail(companyId, productId);
  }

  /** The kind stays: a downsell never turns into an upsell under the buyer. */
  async updateOffer(
    companyId: string,
    productId: string,
    offerId: string,
    dto: UpdateCheckoutOfferDto,
  ) {
    const current = await this.prisma.checkoutOffer.findFirst({
      where: { id: offerId, productId, companyId },
      select: { kind: true },
    });
    if (!current) throw new NotFoundException('Oferta não encontrada.');
    if (current.kind !== dto.kind)
      throw invalid('Crie outra oferta para mudar entre upsell e downsell.');
    await this.assertOffer(companyId, productId, dto);
    const updated = await this.prisma.checkoutOffer.updateMany({
      where: {
        id: offerId,
        productId,
        companyId,
        version: dto.expectedVersion,
      },
      data: { ...this.offerData(dto), version: { increment: 1 } },
    });
    if (updated.count !== 1) versionChanged();
    return this.detail(companyId, productId);
  }

  async reorderBumps(
    companyId: string,
    productId: string,
    dto: ReorderCheckoutBumpsDto,
  ) {
    const product = await this.detail(companyId, productId);
    const current = product.bumps.map((bump) => bump.id).sort();
    if (
      current.length !== dto.bumpIds.length ||
      [...dto.bumpIds].sort().some((id, index) => id !== current[index])
    )
      conflict(
        'VERSION_CHANGED',
        'A lista de order bumps mudou. Recarregue e tente de novo.',
      );
    await this.prisma.$transaction(
      dto.bumpIds.map((id, index) =>
        this.prisma.checkoutOrderBump.updateMany({
          where: { id, productId, companyId },
          data: { position: index + 1 },
        }),
      ),
    );
    return this.detail(companyId, productId);
  }

  private async productData(
    companyId: string,
    dto: CheckoutProductDto,
  ): Promise<
    Omit<Prisma.CheckoutProductUncheckedCreateInput, 'companyId' | 'slug'>
  > {
    assertPrices(dto.priceCents, dto.compareAtPriceCents);
    const accessUrl = normalizeAccessUrl(dto.accessUrl);
    const instructions = dto.accessInstructions?.trim() || null;
    if (dto.deliveryMode !== 'WEBHOOK' && !accessUrl)
      throw invalid('Informe o link de acesso enviado ao comprador.');
    // With webhook only, the page tells the buyer how access arrives.
    if (dto.deliveryMode === 'WEBHOOK' && !instructions)
      throw invalid('Explique ao comprador como ele vai receber o acesso.');
    await this.assets.assertOwned(
      this.prisma,
      companyId,
      dto.imageAssetId,
      'PRODUCT_IMAGE',
    );
    const afterPurchaseUrl = normalizeAccessUrl(dto.afterPurchaseUrl, 'página');
    if (dto.afterPurchase === 'EXTERNAL' && !afterPurchaseUrl)
      throw invalid('Informe o endereço da sua página de oferta.');
    return {
      ...(dto.afterPurchase === undefined
        ? {}
        : {
            afterPurchase: dto.afterPurchase,
            afterPurchaseUrl:
              dto.afterPurchase === 'EXTERNAL' ? afterPurchaseUrl : null,
          }),
      ...(dto.offerWindowMinutes === undefined
        ? {}
        : { offerWindowMinutes: dto.offerWindowMinutes }),
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      priceCents: dto.priceCents,
      compareAtPriceCents: dto.compareAtPriceCents ?? null,
      imageAssetId: dto.imageAssetId ?? null,
      accessPeriodMonths: dto.accessPeriodMonths ?? null,
      deliveryMode: dto.deliveryMode,
      accessUrl,
      accessInstructions: instructions,
    };
  }

  private bumpData(dto: CheckoutBumpDto) {
    return {
      priceCents: dto.priceCents,
      compareAtPriceCents: dto.compareAtPriceCents ?? null,
      headline: dto.headline?.trim() || null,
      description: dto.description?.trim() || null,
      active: dto.active,
    };
  }

  private async assertBump(
    companyId: string,
    productId: string,
    dto: CheckoutBumpDto,
    bumpId: string | null,
  ): Promise<void> {
    assertPrices(dto.priceCents, dto.compareAtPriceCents);
    if (dto.offeredProductId === productId)
      throw invalid('O order bump precisa ser outro produto.');
    const offered = await this.prisma.checkoutProduct.count({
      where: { id: dto.offeredProductId, companyId },
    });
    if (!offered) throw new NotFoundException('Produto não encontrado.');
    if (!dto.active) return;
    const activeOthers = await this.prisma.checkoutOrderBump.count({
      where: {
        productId,
        companyId,
        active: true,
        ...(bumpId ? { id: { not: bumpId } } : {}),
      },
    });
    if (activeOthers >= MAX_ACTIVE_BUMPS)
      conflict(
        'CHECKOUT_BUMP_LIMIT',
        `Cada produto pode ter no máximo ${MAX_ACTIVE_BUMPS} order bumps ativos.`,
      );
  }

  private offerData(dto: CheckoutOfferDto) {
    return {
      offeredProductId: dto.offeredProductId,
      priceCents: dto.priceCents,
      compareAtPriceCents: dto.compareAtPriceCents ?? null,
      headline: dto.headline?.trim() || null,
      description: dto.description?.trim() || null,
      active: dto.active,
    };
  }

  private async assertOffer(
    companyId: string,
    productId: string,
    dto: CheckoutOfferDto,
  ): Promise<void> {
    assertPrices(dto.priceCents, dto.compareAtPriceCents);
    if (dto.offeredProductId === productId)
      throw invalid('A oferta precisa ser outro produto.');
    const offered = await this.prisma.checkoutProduct.count({
      where: { id: dto.offeredProductId, companyId },
    });
    if (!offered) throw new NotFoundException('Produto não encontrado.');
    if (dto.kind === 'DOWNSELL') {
      const upsell = await this.prisma.checkoutOffer.count({
        where: { productId, companyId, kind: 'UPSELL' },
      });
      if (!upsell)
        throw invalid(
          'Crie o upsell antes do downsell: ele aparece só para quem recusa o upsell.',
        );
    }
  }

  private duplicateOffer(): never {
    conflict(
      'CHECKOUT_OFFER_EXISTS',
      'Este produto já tem uma oferta deste tipo. Edite a que existe.',
    );
  }

  private duplicateBump(): never {
    conflict(
      'CHECKOUT_BUMP_EXISTS',
      'Este produto já é order bump deste produto.',
    );
  }

  private async missingOrChanged(
    companyId: string,
    id: string,
  ): Promise<never> {
    await this.detail(companyId, id);
    versionChanged();
  }
}
