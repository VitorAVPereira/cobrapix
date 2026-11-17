import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CheckoutCardService } from './checkout-card.service';
import type { CheckoutPlatformService } from './checkout-platform.service';
import { CheckoutPlansService } from './checkout-plans.service';
import { quoteOrder } from './checkout-pricing';
import { CreateCheckoutPlanDto } from './dto/checkout-plan.dto';

const PRODUCT = '6f1c2f62-1a1b-4c55-9f4e-0d1c2b3a4f5e';

describe('CheckoutPlansService', () => {
  const prisma = {
    checkoutProduct: { count: jest.fn() },
    checkoutPlan: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    checkoutSellerTerms: { findFirst: jest.fn() },
    checkoutSettings: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const platform = { ready: jest.fn(), cardReady: jest.fn() };
  const card = { optionsFor: jest.fn() };
  const service = new CheckoutPlansService(
    prisma as unknown as PrismaService,
    platform as unknown as CheckoutPlatformService,
    card as unknown as CheckoutCardService,
  );
  const dto: CreateCheckoutPlanDto = {
    productId: PRODUCT,
    name: ' Anual ',
    intervalMonths: 12,
    billing: 'INSTALLMENT',
    priceCents: 7500,
    maxInstallments: 12,
    active: true,
  };
  const saved = {
    id: 'plan-1',
    productId: PRODUCT,
    intervalMonths: 12,
    billing: 'INSTALLMENT',
    active: true,
    version: 1,
    _count: { orders: 0 },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.checkoutProduct.count.mockResolvedValue(1);
    prisma.checkoutPlan.count.mockResolvedValue(0);
    prisma.checkoutPlan.findFirst.mockReset().mockResolvedValue(saved);
    prisma.checkoutPlan.create.mockResolvedValue({ id: 'plan-1' });
    prisma.checkoutPlan.updateMany.mockResolvedValue({ count: 1 });
    prisma.checkoutSellerTerms.findFirst.mockResolvedValue({
      platformFeeBasisPoints: 500,
    });
    prisma.checkoutSettings.findUnique.mockResolvedValue({
      pixFeePayer: 'SELLER',
      cardFeePayer: 'BUYER',
      maxInstallments: 12,
    });
    platform.ready.mockResolvedValue({
      settings: { pixFeeBasisPoints: 119 },
    });
    platform.cardReady.mockResolvedValue(null);
  });

  it('cria o plano no fim da lista, sempre na empresa do usuário', async () => {
    prisma.checkoutPlan.findFirst
      .mockResolvedValueOnce({ position: 2 })
      .mockResolvedValue(saved);

    await service.create('company-a', dto);

    expect(prisma.checkoutProduct.count).toHaveBeenCalledWith({
      where: { id: PRODUCT, companyId: 'company-a' },
    });
    const [created] = prisma.checkoutPlan.create.mock.calls[0] as [
      { data: unknown },
    ];
    expect(created.data).toMatchObject({
      companyId: 'company-a',
      productId: PRODUCT,
      name: 'Anual',
      position: 3,
      pixFeePayer: null,
      cardFeePayer: null,
    });
  });

  it('produto de outra empresa responde 404 e nada é criado', async () => {
    prisma.checkoutProduct.count.mockResolvedValue(0);

    await expect(service.create('company-b', dto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.checkoutPlan.create).not.toHaveBeenCalled();
  });

  it('plano de outra empresa responde 404 ao editar e ao ativar', async () => {
    prisma.checkoutPlan.findFirst.mockResolvedValue(null);

    await expect(
      service.update('company-b', 'plan-1', { ...dto, expectedVersion: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.setActive('company-b', 'plan-1', {
        active: false,
        expectedVersion: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.checkoutPlan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'plan-1', companyId: 'company-b' },
      }),
    );
    expect(prisma.checkoutPlan.updateMany).not.toHaveBeenCalled();
  });

  it('recusa preço abaixo do mínimo e parcelas num plano recorrente', async () => {
    await expect(
      service.create('company-a', { ...dto, priceCents: 499 }),
    ).rejects.toMatchObject({ response: { code: 'CHECKOUT_INVALID' } });
    await expect(
      service.create('company-a', { ...dto, billing: 'RECURRING' }),
    ).rejects.toMatchObject({ response: { code: 'CHECKOUT_INVALID' } });
  });

  it('o sétimo plano ativo é recusado', async () => {
    prisma.checkoutPlan.count.mockResolvedValue(6);

    await expect(service.create('company-a', dto)).rejects.toMatchObject({
      response: { code: 'CHECKOUT_PLAN_LIMIT' },
    });
  });

  it('plano com vendas não muda a periodicidade nem o tipo; o preço muda', async () => {
    prisma.checkoutPlan.findFirst.mockResolvedValue({
      ...saved,
      _count: { orders: 2 },
    });

    await expect(
      service.update('company-a', 'plan-1', {
        ...dto,
        intervalMonths: 3,
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ response: { code: 'CHECKOUT_PLAN_LOCKED' } });
    await service.update('company-a', 'plan-1', {
      ...dto,
      priceCents: 8900,
      expectedVersion: 1,
    });
    expect(prisma.checkoutPlan.updateMany).toHaveBeenCalledTimes(1);
  });

  it('versão desatualizada responde 409 em vez de sobrescrever', async () => {
    prisma.checkoutPlan.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.update('company-a', 'plan-1', { ...dto, expectedVersion: 1 }),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CHANGED' } });
  });

  describe('líquido do vendedor', () => {
    it('no Pix é o mesmo valor que o pedido lança no saldo, com e sem repasse', async () => {
      const preview = await service.preview('company-a', {
        billing: 'INSTALLMENT',
        priceCents: 7500,
      });

      for (const feePayer of ['SELLER', 'BUYER'] as const) {
        const order = quoteOrder({
          product: {
            id: 'p',
            name: 'p',
            priceCents: 7500,
            deliveryMode: 'ACCESS_LINK',
            accessUrl: null,
            accessInstructions: null,
            accessPeriodMonths: 12,
          },
          bumps: [],
          coupon: null,
          feePayer,
          efiFeeBasisPoints: 119,
          platformFeeBasisPoints: 500,
        });
        const line =
          preview.pix![feePayer === 'SELLER' ? 'seller' : 'buyer'][0]!;
        expect(line.buyerTotalCents).toBe(order.totalCents);
        // The ledger: sale (total) minus the Efí tariff minus the Cifra+ %.
        expect(line.netCents).toBe(
          order.totalCents - order.efiFeeCents - order.platformFeeCents,
        );
      }
      expect(preview.pix!.seller[0]).toMatchObject({
        buyerTotalCents: 7500,
        efiFeeCents: 89,
        platformFeeCents: 375,
        netCents: 7036,
      });
      // Passing the tariff on: the price minus the Cifra+ %, rounded up a cent.
      expect(preview.pix!.buyer[0]!.netCents).toBe(7126);
      expect(preview.card).toBeNull();
    });

    it('no cartão parcelado cota 1x e o máximo de parcelas pelas regras do pedido', async () => {
      const account = { rates: {} };
      platform.cardReady.mockResolvedValue(account);
      card.optionsFor.mockResolvedValue([
        { installments: 1, totalCents: 7500, efiFeeCents: 262 },
        { installments: 3, totalCents: 7800, efiFeeCents: 600 },
      ]);

      const preview = await service.preview('company-a', {
        billing: 'INSTALLMENT',
        priceCents: 7500,
        maxInstallments: 3,
      });

      expect(card.optionsFor).toHaveBeenCalledWith(
        7500,
        3,
        'SELLER',
        account,
        'visa',
        [1, 3],
      );
      expect(preview.card!.seller[1]).toEqual({
        installments: 3,
        buyerTotalCents: 7800,
        efiFeeCents: 600,
        platformFeeCents: 375,
        netCents: 6825,
      });
    });

    it('no cartão recorrente é à vista, sem consultar parcelas na Efí', async () => {
      platform.cardReady.mockResolvedValue({
        rates: {
          receipt: 'ANTICIPATED',
          cashBasisPoints: 349,
          anticipationBasisPoints: 129,
        },
      });

      const preview = await service.preview('company-a', {
        billing: 'RECURRING',
        priceCents: 2990,
      });

      expect(card.optionsFor).not.toHaveBeenCalled();
      const seller = preview.card!.seller[0]!;
      expect(seller.installments).toBe(1);
      expect(seller.buyerTotalCents).toBe(2990);
      expect(seller.netCents).toBe(2990 - seller.efiFeeCents - 150);
      // Passing the tariff on: the seller keeps the price minus the Cifra+ %.
      const buyer = preview.card!.buyer[0]!;
      expect(buyer.netCents).toBeGreaterThanOrEqual(2990 - 150);
      expect(buyer.netCents).toBeLessThanOrEqual(2990 - 150 + 1);
    });

    it('sem a conta Cifra+ pronta devolve só o que dá para calcular', async () => {
      platform.ready.mockResolvedValue(null);

      await expect(
        service.preview('company-a', {
          billing: 'INSTALLMENT',
          priceCents: 7500,
        }),
      ).resolves.toMatchObject({ pix: null, card: null });
    });
  });
});
