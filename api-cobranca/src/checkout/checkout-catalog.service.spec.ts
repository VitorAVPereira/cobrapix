import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CheckoutPlatformService } from './checkout-platform.service';
import { CheckoutCatalogService } from './checkout-catalog.service';

const offered = {
  id: 'guia',
  name: 'Guia Renda Fixa',
  description: 'Um guia simples',
  priceCents: 2990,
  compareAtPriceCents: null,
  imageAssetId: 'img-guia',
  accessPeriodMonths: null,
  deliveryMode: 'ACCESS_LINK',
  accessUrl: 'https://segredo.test/guia',
  accessInstructions: null,
  active: true,
};

describe('CheckoutCatalogService', () => {
  const prisma = {
    checkoutProduct: { findFirst: jest.fn() },
    checkoutSettings: { findUnique: jest.fn() },
    checkoutSellerTerms: { findFirst: jest.fn() },
    checkoutCoupon: { findUnique: jest.fn() },
  };
  const platform = { ready: jest.fn(), cardReady: jest.fn() };
  const service = new CheckoutCatalogService(
    prisma as unknown as PrismaService,
    platform as unknown as CheckoutPlatformService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.checkoutProduct.findFirst.mockResolvedValue({
      ...offered,
      id: 'main',
      name: 'Porquim Anual',
      priceCents: 6700,
      accessUrl: 'https://segredo.test/porquim',
      companyId: 'company-a',
      bumps: [
        {
          id: 'bump-1',
          priceCents: 1490,
          compareAtPriceCents: 2990,
          headline: 'GUIA COM 50% OFF',
          description: null,
          offeredProduct: offered,
        },
      ],
    });
    prisma.checkoutSettings.findUnique.mockResolvedValue({
      displayName: 'Porquim',
      logoAssetId: null,
      bannerAssetId: 'banner-1',
      primaryColor: '#0F766E',
      supportEmail: null,
      supportWhatsapp: null,
      whatsappButtonPhone: '11999999999',
      pixEnabled: true,
      pixFeePayer: 'SELLER',
    });
    prisma.checkoutSellerTerms.findFirst.mockResolvedValue({
      id: 'terms-1',
      platformFeeBasisPoints: 250,
      payoutPixKey: 'chave-secreta',
    });
    platform.ready.mockResolvedValue({
      settings: { id: 'settings-1', pixFeeBasisPoints: 119 },
      identity: { pixKey: 'pix@ciframais.test' },
    });
  });

  it('a página pública não expõe links de acesso, termos nem a conta', async () => {
    const view = await service.view('porquim-anual-ab12');
    const text = JSON.stringify(view);

    expect(view.available).toBe(true);
    expect(view.bumps[0]).toMatchObject({
      name: 'Guia Renda Fixa',
      headline: 'GUIA COM 50% OFF',
      description: 'Um guia simples',
      imageUrl: '/checkout/public/assets/img-guia',
    });
    expect(view.page.bannerUrl).toBe('/checkout/public/assets/banner-1');
    for (const secret of [
      'segredo.test',
      'chave-secreta',
      'pix@ciframais.test',
      '250',
    ])
      expect(text).not.toContain(secret);
  });

  it('sem a conta da Cifra+ pronta a página avisa e não cota', async () => {
    platform.ready.mockResolvedValue(null);

    await expect(service.view('porquim-anual-ab12')).resolves.toMatchObject({
      available: false,
    });
    await expect(
      service.quote('porquim-anual-ab12', { bumpIds: [], method: 'PIX' }),
    ).rejects.toMatchObject({ response: { code: 'CHECKOUT_UNAVAILABLE' } });
  });

  it('produto inativo ou de empresa inativa responde 404', async () => {
    prisma.checkoutProduct.findFirst.mockResolvedValue(null);
    await expect(service.view('nada')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.checkoutProduct.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          slug: 'nada',
          active: true,
          company: { product: 'CHECKOUT', status: 'ACTIVE' },
        },
      }),
    );
  });

  it('bump que saiu da página e cupom inválido explicam em português', async () => {
    await expect(
      service.quote('porquim-anual-ab12', {
        bumpIds: ['6f1c2f62-1a1b-4c55-9f4e-0d1c2b3a4f5e'],
        method: 'PIX',
      }),
    ).rejects.toMatchObject({
      response: { code: 'CHECKOUT_BUMP_UNAVAILABLE' },
    });

    prisma.checkoutCoupon.findUnique.mockResolvedValue(null);
    await expect(
      service.quote('porquim-anual-ab12', {
        bumpIds: [],
        couponCode: 'nada',
        method: 'PIX',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'CHECKOUT_COUPON_INVALID',
        message: 'Cupom não encontrado.',
      },
    });
  });

  it('cota com bump e cupom', async () => {
    prisma.checkoutCoupon.findUnique.mockResolvedValue({
      id: 'coupon-1',
      code: 'PORQUIM10',
      type: 'PERCENT',
      value: 1000,
      active: true,
      startsAt: null,
      expiresAt: null,
      maxUses: null,
      usedCount: 0,
      appliesToAllProducts: true,
      products: [],
    });
    const quote = await service.quote('porquim-anual-ab12', {
      bumpIds: ['bump-1'],
      couponCode: 'porquim10',
      method: 'PIX',
    });
    expect(quote).toMatchObject({
      couponCode: 'PORQUIM10',
      discountCents: 670,
      subtotalCents: 6700 + 1490 - 670,
      totalCents: 6700 + 1490 - 670,
    });
    expect(prisma.checkoutCoupon.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId_code: { companyId: 'company-a', code: 'PORQUIM10' },
        },
      }),
    );
  });
});
