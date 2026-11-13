import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutAssetsService } from './checkout-assets.service';
import { CheckoutProductsService } from './checkout-products.service';
import {
  CheckoutBumpDto,
  CheckoutProductDto,
} from './dto/checkout-product.dto';

const OFFERED = '6f1c2f62-1a1b-4c55-9f4e-0d1c2b3a4f5e';

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

interface CreateArg {
  data: { companyId?: string; slug?: string; accessUrl?: string | null };
}

describe('CheckoutProductsService', () => {
  const prisma = {
    checkoutProduct: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    checkoutOrderBump: {
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
    checkoutOffer: {
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const assets = { assertOwned: jest.fn() };
  const service = new CheckoutProductsService(
    prisma as unknown as PrismaService,
    assets as unknown as CheckoutAssetsService,
  );
  const product: CheckoutProductDto = {
    name: 'Porquim Anual',
    priceCents: 6700,
    compareAtPriceCents: 9700,
    accessPeriodMonths: 12,
    deliveryMode: 'ACCESS_LINK',
    accessUrl: 'https://porquim.test/acesso',
  };
  const bump: CheckoutBumpDto = {
    offeredProductId: OFFERED,
    priceCents: 1490,
    compareAtPriceCents: 2990,
    headline: 'GUIA COM 50% OFF',
    active: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.checkoutProduct.create.mockResolvedValue({ id: 'product-1' });
    prisma.checkoutProduct.findFirst.mockResolvedValue({
      id: 'product-1',
      bumps: [],
    });
    prisma.checkoutProduct.count.mockResolvedValue(1);
    prisma.checkoutOrderBump.count.mockResolvedValue(0);
    prisma.checkoutOrderBump.findFirst.mockResolvedValue(null);
    prisma.checkoutOrderBump.create.mockResolvedValue({ id: 'bump-1' });
    prisma.checkoutOffer.count.mockResolvedValue(1);
  });

  describe('ofertas depois da compra', () => {
    const offer = {
      kind: 'UPSELL' as const,
      offeredProductId: OFFERED,
      priceCents: 4900,
      compareAtPriceCents: 9700,
      headline: 'Leve o guia completo',
      active: true,
    };

    it('cria o upsell de outro produto da empresa', async () => {
      await service.createOffer('company-a', 'product-1', offer);
      expect(prisma.checkoutOffer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: 'company-a',
          productId: 'product-1',
          kind: 'UPSELL',
          offeredProductId: OFFERED,
          priceCents: 4900,
        }) as unknown,
      });
      expect(prisma.checkoutProduct.count).toHaveBeenCalledWith({
        where: { id: OFFERED, companyId: 'company-a' },
      });
    });

    it('downsell só depois do upsell; um de cada por produto', async () => {
      prisma.checkoutOffer.count.mockResolvedValue(0);
      await expect(
        service.createOffer('company-a', 'product-1', {
          ...offer,
          kind: 'DOWNSELL',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      prisma.checkoutOffer.create.mockRejectedValue(uniqueViolation());
      await expect(
        service.createOffer('company-a', 'product-1', offer),
      ).rejects.toMatchObject({ response: { code: 'CHECKOUT_OFFER_EXISTS' } });
    });

    it('produto de outra empresa ou o próprio produto não viram oferta', async () => {
      prisma.checkoutProduct.count.mockResolvedValue(0);
      await expect(
        service.createOffer('company-a', 'product-1', offer),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.createOffer('company-a', OFFERED, offer),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('edição com versão antiga responde 409 e o tipo não muda', async () => {
      prisma.checkoutOffer.findFirst.mockResolvedValue({ kind: 'UPSELL' });
      prisma.checkoutOffer.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.updateOffer('company-a', 'product-1', 'offer-1', {
          ...offer,
          expectedVersion: 1,
        }),
      ).rejects.toMatchObject({ response: { code: 'VERSION_CHANGED' } });
      await expect(
        service.updateOffer('company-a', 'product-1', 'offer-1', {
          ...offer,
          kind: 'DOWNSELL',
          expectedVersion: 2,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      prisma.checkoutOffer.findFirst.mockResolvedValue(null);
      await expect(
        service.updateOffer('company-b', 'product-1', 'offer-1', {
          ...offer,
          expectedVersion: 2,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('página externa depois da compra exige https', async () => {
      await expect(
        service.create('company-a', { ...product, afterPurchase: 'EXTERNAL' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create('company-a', {
          ...product,
          afterPurchase: 'EXTERNAL',
          afterPurchaseUrl: 'http://vendedor.test/oferta',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await service.create('company-a', {
        ...product,
        afterPurchase: 'EXTERNAL',
        afterPurchaseUrl: 'https://vendedor.test/oferta',
        offerWindowMinutes: 60,
      });
      expect(prisma.checkoutProduct.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            afterPurchase: 'EXTERNAL',
            afterPurchaseUrl: 'https://vendedor.test/oferta',
            offerWindowMinutes: 60,
          }) as unknown,
        }),
      );
    });

    it('tela antiga sem os campos novos não muda o destino salvo', async () => {
      prisma.checkoutProduct.updateMany.mockResolvedValue({ count: 1 });
      await service.update('company-a', 'product-1', {
        ...product,
        expectedVersion: 3,
      });
      const data = (
        prisma.checkoutProduct.updateMany.mock.calls as [
          { data: Record<string, unknown> },
        ][]
      )[0]?.[0].data;
      expect(data).not.toHaveProperty('afterPurchase');
      expect(data).not.toHaveProperty('offerWindowMinutes');
      expect(data).not.toHaveProperty('logoAssetId');
      expect(data).not.toHaveProperty('bannerAssetId');
      expect(data).not.toHaveProperty('primaryColor');
    });
  });

  it('logo, banner e cor do produto: imagens da empresa, cor em maiúsculas, nulo volta ao padrão', async () => {
    prisma.checkoutProduct.updateMany.mockResolvedValue({ count: 1 });
    await service.update('company-a', 'product-1', {
      ...product,
      logoAssetId: 'logo-1',
      bannerAssetId: 'banner-1',
      primaryColor: '#e5484d',
      expectedVersion: 3,
    });
    await service.update('company-a', 'product-1', {
      ...product,
      logoAssetId: null,
      bannerAssetId: null,
      primaryColor: null,
      expectedVersion: 4,
    });

    expect(assets.assertOwned).toHaveBeenCalledWith(
      prisma,
      'company-a',
      'logo-1',
      'LOGO',
    );
    expect(assets.assertOwned).toHaveBeenCalledWith(
      prisma,
      'company-a',
      'banner-1',
      'BANNER',
    );
    const calls = prisma.checkoutProduct.updateMany.mock.calls as [
      { data: Record<string, unknown> },
    ][];
    expect(calls[0][0].data).toMatchObject({
      logoAssetId: 'logo-1',
      bannerAssetId: 'banner-1',
      primaryColor: '#E5484D',
    });
    expect(calls[1][0].data).toMatchObject({
      logoAssetId: null,
      bannerAssetId: null,
      primaryColor: null,
    });
  });

  it('cria produto da empresa com link fixo', async () => {
    await service.create('company-a', product);

    const arg = (
      prisma.checkoutProduct.create.mock.calls as [CreateArg][]
    )[0]?.[0] as CreateArg;
    expect(arg.data.companyId).toBe('company-a');
    expect(arg.data.slug).toMatch(/^porquim-anual-[a-z2-9]{4}$/);
    expect(arg.data.accessUrl).toBe('https://porquim.test/acesso');
  });

  it('tenta outro link quando o sorteado já existe', async () => {
    prisma.checkoutProduct.create
      .mockRejectedValueOnce(uniqueViolation())
      .mockResolvedValueOnce({ id: 'product-1' });

    await service.create('company-a', product);
    expect(prisma.checkoutProduct.create).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['preço abaixo de R$ 5,00', { priceCents: 499, compareAtPriceCents: null }],
    ['"De" menor ou igual ao preço', { compareAtPriceCents: 6700 }],
    ['link sem https', { accessUrl: 'http://porquim.test' }],
    ['link ausente na entrega por link', { accessUrl: null }],
    [
      'webhook sem instruções ao comprador',
      { deliveryMode: 'WEBHOOK' as const, accessUrl: null },
    ],
  ])('recusa %s', async (_label, change) => {
    await expect(
      service.create('company-a', { ...product, ...change }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.checkoutProduct.create).not.toHaveBeenCalled();
  });

  it('confere a imagem do produto na empresa', async () => {
    assets.assertOwned.mockRejectedValueOnce(new NotFoundException());
    await expect(
      service.create('company-a', { ...product, imageAssetId: 'asset-b' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(assets.assertOwned).toHaveBeenCalledWith(
      prisma,
      'company-a',
      'asset-b',
      'PRODUCT_IMAGE',
    );
  });

  it('versão antiga responde VERSION_CHANGED; produto de outra empresa, 404', async () => {
    prisma.checkoutProduct.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.update('company-a', 'product-1', {
        ...product,
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CHANGED' } });

    prisma.checkoutProduct.findFirst.mockResolvedValue(null);
    await expect(
      service.update('company-a', 'product-b', {
        ...product,
        expectedVersion: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cria bump no fim da lista', async () => {
    prisma.checkoutOrderBump.findFirst.mockResolvedValue({ position: 2 });
    await service.createBump('company-a', 'product-1', bump);

    expect(prisma.checkoutOrderBump.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'company-a',
        productId: 'product-1',
        offeredProductId: OFFERED,
        position: 3,
      }) as unknown,
    });
  });

  it('guarda a frase do bump sem espaços nas pontas; vazia vira nula', async () => {
    await service.createBump('company-a', 'product-1', {
      ...bump,
      callToAction: '  Pare de deixar seu dinheiro parado  ',
    });
    await service.createBump('company-a', 'product-1', {
      ...bump,
      callToAction: '   ',
    });

    const calls = prisma.checkoutOrderBump.create.mock.calls as Array<
      [{ data: { callToAction: string | null } }]
    >;
    expect(calls[0][0].data.callToAction).toBe(
      'Pare de deixar seu dinheiro parado',
    );
    expect(calls[1][0].data.callToAction).toBeNull();
  });

  it('recusa bump do próprio produto e de produto de outra empresa', async () => {
    await expect(
      service.createBump('company-a', OFFERED, bump),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.checkoutProduct.count.mockResolvedValue(0);
    await expect(
      service.createBump('company-a', 'product-1', bump),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.checkoutOrderBump.create).not.toHaveBeenCalled();
  });

  it('o sétimo bump ativo é recusado; um inativo não conta', async () => {
    prisma.checkoutOrderBump.count.mockResolvedValue(6);
    await expect(
      service.createBump('company-a', 'product-1', bump),
    ).rejects.toMatchObject({ response: { code: 'CHECKOUT_BUMP_LIMIT' } });

    await service.createBump('company-a', 'product-1', {
      ...bump,
      active: false,
    });
    expect(prisma.checkoutOrderBump.create).toHaveBeenCalledTimes(1);
  });

  it('o mesmo produto oferecido duas vezes responde 409', async () => {
    prisma.checkoutOrderBump.create.mockRejectedValue(uniqueViolation());
    await expect(
      service.createBump('company-a', 'product-1', bump),
    ).rejects.toMatchObject({ response: { code: 'CHECKOUT_BUMP_EXISTS' } });
  });

  it('remover bump de outra empresa responde 404', async () => {
    prisma.checkoutOrderBump.deleteMany.mockResolvedValue({ count: 0 });
    await expect(
      service.removeBump('company-a', 'product-1', 'bump-b'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.checkoutOrderBump.deleteMany).toHaveBeenCalledWith({
      where: { id: 'bump-b', productId: 'product-1', companyId: 'company-a' },
    });
  });

  it('reordenar com lista diferente da atual responde VERSION_CHANGED', async () => {
    prisma.checkoutProduct.findFirst.mockResolvedValue({
      id: 'product-1',
      bumps: [{ id: 'bump-1' }, { id: 'bump-2' }],
    });
    await expect(
      service.reorderBumps('company-a', 'product-1', { bumpIds: ['bump-1'] }),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CHANGED' } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
