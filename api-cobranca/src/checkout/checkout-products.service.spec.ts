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
  });

  it('cria produto da empresa com link fixo', async () => {
    await service.create('company-a', product);

    const arg = (
      prisma.checkoutProduct.create.mock.calls as CreateArg[][]
    )[0][0];
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
