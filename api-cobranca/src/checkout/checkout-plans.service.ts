import { Injectable, NotFoundException } from '@nestjs/common';
import { CheckoutFeePayer } from '@prisma/client';
import { cardProcessingBasisPoints } from '../payment/efi-card.client';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutCardService } from './checkout-card.service';
import { CheckoutPlatformService } from './checkout-platform.service';
import { quoteOrder } from './checkout-pricing';
import {
  assertPrices,
  conflict,
  invalid,
  versionChanged,
} from './checkout-rules';
import {
  CheckoutPlanDto,
  CheckoutPlanPreviewDto,
  CreateCheckoutPlanDto,
  ReorderCheckoutPlansDto,
  UpdateCheckoutPlanDto,
} from './dto/checkout-plan.dto';
import { SetCheckoutActiveDto } from './dto/checkout-product.dto';

export const MAX_ACTIVE_PLANS = 6;

/** One line of the seller's preview: what the buyer pays and what is left. */
export interface PlanNetLine {
  installments: number;
  buyerTotalCents: number;
  efiFeeCents: number;
  platformFeeCents: number;
  netCents: number;
}

const FEE_PAYERS: CheckoutFeePayer[] = ['SELLER', 'BUYER'];

@Injectable()
export class CheckoutPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: CheckoutPlatformService,
    private readonly card: CheckoutCardService,
  ) {}

  list(companyId: string, productId?: string) {
    return this.prisma.checkoutPlan.findMany({
      where: { companyId, ...(productId ? { productId } : {}) },
      orderBy: [{ productId: 'asc' }, { position: 'asc' }],
      include: {
        product: { select: { id: true, name: true, slug: true, active: true } },
        _count: { select: { orders: true } },
      },
    });
  }

  async create(companyId: string, dto: CreateCheckoutPlanDto) {
    const product = await this.prisma.checkoutProduct.count({
      where: { id: dto.productId, companyId },
    });
    if (!product) throw new NotFoundException('Produto não encontrado.');
    const data = this.planData(dto);
    if (dto.active) await this.assertLimit(companyId, dto.productId, null);
    const last = await this.prisma.checkoutPlan.findFirst({
      where: { productId: dto.productId, companyId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const created = await this.prisma.checkoutPlan.create({
      data: {
        ...data,
        companyId,
        productId: dto.productId,
        position: (last?.position ?? 0) + 1,
      },
      select: { id: true },
    });
    return this.detail(companyId, created.id);
  }

  async update(companyId: string, id: string, dto: UpdateCheckoutPlanDto) {
    const current = await this.detail(companyId, id);
    const data = this.planData(dto);
    // Buyers were sold this period and this way of charging.
    if (
      current._count.orders &&
      (current.intervalMonths !== dto.intervalMonths ||
        current.billing !== dto.billing)
    )
      conflict(
        'CHECKOUT_PLAN_LOCKED',
        'Este plano já tem vendas: a periodicidade e o tipo de cobrança não mudam. Crie outro plano.',
      );
    if (dto.active && !current.active)
      await this.assertLimit(companyId, current.productId, id);
    const updated = await this.prisma.checkoutPlan.updateMany({
      where: { id, companyId, version: dto.expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (updated.count !== 1) versionChanged();
    return this.detail(companyId, id);
  }

  /** An inactive plan leaves the page; whoever bought it keeps the purchase. */
  async setActive(companyId: string, id: string, dto: SetCheckoutActiveDto) {
    const current = await this.detail(companyId, id);
    if (dto.active && !current.active)
      await this.assertLimit(companyId, current.productId, id);
    const updated = await this.prisma.checkoutPlan.updateMany({
      where: { id, companyId, version: dto.expectedVersion },
      data: { active: dto.active, version: { increment: 1 } },
    });
    if (updated.count !== 1) versionChanged();
    return this.detail(companyId, id);
  }

  async reorder(companyId: string, dto: ReorderCheckoutPlansDto) {
    const current = (await this.list(companyId, dto.productId))
      .map((plan) => plan.id)
      .sort();
    if (!current.length) throw new NotFoundException('Plano não encontrado.');
    if (
      current.length !== dto.planIds.length ||
      [...dto.planIds].sort().some((id, index) => id !== current[index])
    )
      conflict(
        'VERSION_CHANGED',
        'A lista de planos mudou. Recarregue e tente de novo.',
      );
    await this.prisma.$transaction(
      dto.planIds.map((id, index) =>
        this.prisma.checkoutPlan.updateMany({
          where: { id, productId: dto.productId, companyId },
          data: { position: index + 1 },
        }),
      ),
    );
    return this.list(companyId, dto.productId);
  }

  /**
   * What the seller keeps for a price, with and without passing the Efí
   * tariff on to the buyer. Same math as a real order; a method that is not
   * ready on the Cifra+ account comes back null.
   */
  async preview(companyId: string, dto: CheckoutPlanPreviewDto) {
    assertPrices(dto.priceCents, null);
    const [terms, settings, platform, cardAccount] = await Promise.all([
      this.prisma.checkoutSellerTerms.findFirst({
        where: { companyId },
        orderBy: { version: 'desc' },
      }),
      this.prisma.checkoutSettings.findUnique({ where: { companyId } }),
      this.platform.ready(),
      this.platform.cardReady(),
    ]);
    if (!terms || !settings)
      throw new NotFoundException(
        'Configure o checkout antes de criar planos.',
      );
    const platformFeeBasisPoints = terms.platformFeeBasisPoints;
    const platformFeeCents = Math.round(
      (dto.priceCents * platformFeeBasisPoints) / 10_000,
    );
    const line = (
      installments: number,
      buyerTotalCents: number,
      efiFeeCents: number,
    ): PlanNetLine => ({
      installments,
      buyerTotalCents,
      efiFeeCents,
      platformFeeCents,
      netCents: buyerTotalCents - efiFeeCents - platformFeeCents,
    });
    const byPayer = async <T>(
      build: (payer: CheckoutFeePayer) => T | Promise<T>,
    ) => {
      const [seller, buyer] = await Promise.all(FEE_PAYERS.map(build));
      return { seller: seller!, buyer: buyer! };
    };

    const pix = platform
      ? await byPayer((feePayer) => {
          const quote = quoteOrder({
            product: {
              id: '',
              name: '',
              priceCents: dto.priceCents,
              deliveryMode: 'ACCESS_LINK',
              accessUrl: null,
              accessInstructions: null,
              accessPeriodMonths: null,
            },
            bumps: [],
            coupon: null,
            feePayer,
            efiFeeBasisPoints: platform.settings.pixFeeBasisPoints,
            platformFeeBasisPoints,
          });
          return [line(1, quote.totalCents, quote.efiFeeCents)];
        })
      : null;

    let card: { seller: PlanNetLine[]; buyer: PlanNetLine[] } | null = null;
    if (cardAccount && dto.billing === 'RECURRING') {
      // A cycle is charged in full: the cash rate, no installment interest.
      const bp = cardProcessingBasisPoints(cardAccount.rates, 1);
      card = await byPayer((feePayer) => {
        const total =
          feePayer === 'BUYER'
            ? Math.ceil((dto.priceCents * 10_000) / (10_000 - bp))
            : dto.priceCents;
        return [line(1, total, Math.round((total * bp) / 10_000))];
      });
    } else if (cardAccount) {
      const max = dto.maxInstallments ?? settings.maxInstallments;
      card = await byPayer(async (feePayer) =>
        (
          await this.card.optionsFor(
            dto.priceCents,
            max,
            feePayer,
            cardAccount,
            // The Efí prices installments by brand; Visa stands for the rest.
            'visa',
            [1, max],
          )
        ).map((option) =>
          line(option.installments, option.totalCents, option.efiFeeCents),
        ),
      );
    }
    return {
      platformFeeBasisPoints,
      // What the plan follows when it does not choose.
      defaults: {
        pixFeePayer: settings.pixFeePayer,
        cardFeePayer: settings.cardFeePayer,
        maxInstallments: settings.maxInstallments,
      },
      pix,
      card,
    };
  }

  private async detail(companyId: string, id: string) {
    const plan = await this.prisma.checkoutPlan.findFirst({
      where: { id, companyId },
      include: {
        product: { select: { id: true, name: true, slug: true, active: true } },
        _count: { select: { orders: true } },
      },
    });
    if (!plan) throw new NotFoundException('Plano não encontrado.');
    return plan;
  }

  private planData(dto: CheckoutPlanDto) {
    assertPrices(dto.priceCents, dto.compareAtPriceCents);
    if (dto.billing === 'RECURRING' && dto.maxInstallments != null)
      throw invalid(
        'O plano recorrente é cobrado à vista a cada ciclo: não tem parcelas.',
      );
    return {
      name: dto.name.trim(),
      intervalMonths: dto.intervalMonths,
      billing: dto.billing,
      priceCents: dto.priceCents,
      compareAtPriceCents: dto.compareAtPriceCents ?? null,
      maxInstallments: dto.maxInstallments ?? null,
      pixFeePayer: dto.pixFeePayer ?? null,
      cardFeePayer: dto.cardFeePayer ?? null,
      active: dto.active,
    };
  }

  private async assertLimit(
    companyId: string,
    productId: string,
    planId: string | null,
  ): Promise<void> {
    const activeOthers = await this.prisma.checkoutPlan.count({
      where: {
        productId,
        companyId,
        active: true,
        ...(planId ? { id: { not: planId } } : {}),
      },
    });
    if (activeOthers >= MAX_ACTIVE_PLANS)
      conflict(
        'CHECKOUT_PLAN_LIMIT',
        `Cada produto pode ter no máximo ${MAX_ACTIVE_PLANS} planos ativos.`,
      );
  }
}
