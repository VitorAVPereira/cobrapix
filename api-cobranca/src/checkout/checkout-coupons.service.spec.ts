import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutCouponsService } from './checkout-coupons.service';
import { couponDiscountCents } from './checkout-rules';
import { CheckoutCouponDto } from './dto/checkout-coupon.dto';

const PRODUCT = '6f1c2f62-1a1b-4c55-9f4e-0d1c2b3a4f5e';

interface CreateArg {
  data: { code: string; companyId: string };
}
interface LinksArg {
  data: Array<{ couponId: string; productId: string; companyId: string }>;
}

describe('couponDiscountCents', () => {
  it('calcula porcentagem e valor fixo', () => {
    expect(couponDiscountCents(6700, { type: 'PERCENT', value: 1000 })).toBe(
      670,
    );
    expect(couponDiscountCents(6700, { type: 'FIXED', value: 1500 })).toBe(
      1500,
    );
  });

  it('o preço com desconto nunca fica abaixo de R$ 5,00', () => {
    expect(couponDiscountCents(6700, { type: 'PERCENT', value: 10_000 })).toBe(
      6200,
    );
    expect(couponDiscountCents(600, { type: 'FIXED', value: 5000 })).toBe(100);
    expect(couponDiscountCents(500, { type: 'FIXED', value: 100 })).toBe(0);
  });
});

describe('CheckoutCouponsService', () => {
  const tx = {
    checkoutCoupon: { create: jest.fn(), updateMany: jest.fn() },
    checkoutCouponProduct: { deleteMany: jest.fn(), createMany: jest.fn() },
  };
  const prisma = {
    checkoutCoupon: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    checkoutProduct: { count: jest.fn() },
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const service = new CheckoutCouponsService(
    prisma as unknown as PrismaService,
  );
  const coupon: CheckoutCouponDto = {
    code: 'porquim10',
    type: 'PERCENT',
    value: 1000,
    appliesToAllProducts: false,
    productIds: [PRODUCT],
    active: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.checkoutProduct.count.mockResolvedValue(1);
    tx.checkoutCoupon.create.mockResolvedValue({ id: 'coupon-1' });
    prisma.checkoutCoupon.findFirst.mockResolvedValue({ id: 'coupon-1' });
    tx.checkoutCoupon.updateMany.mockResolvedValue({ count: 1 });
  });

  it('cria cupom em maiúsculas ligado aos produtos da empresa', async () => {
    await service.create('company-a', coupon);

    const arg = (
      tx.checkoutCoupon.create.mock.calls as [CreateArg][]
    )[0]?.[0] as CreateArg;
    expect(arg.data.code).toBe('PORQUIM10');
    expect(arg.data.companyId).toBe('company-a');
    const links = (
      tx.checkoutCouponProduct.createMany.mock.calls as [LinksArg][]
    )[0]?.[0] as LinksArg;
    expect(links.data).toEqual([
      { couponId: 'coupon-1', productId: PRODUCT, companyId: 'company-a' },
    ]);
    expect(prisma.checkoutProduct.count).toHaveBeenCalledWith({
      where: { id: { in: [PRODUCT] }, companyId: 'company-a' },
    });
  });

  it('produto de outra empresa responde 404', async () => {
    prisma.checkoutProduct.count.mockResolvedValue(0);
    await expect(service.create('company-a', coupon)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('código repetido na empresa responde 409', async () => {
    tx.checkoutCoupon.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(service.create('company-a', coupon)).rejects.toMatchObject({
      response: { code: 'CHECKOUT_COUPON_EXISTS' },
    });
  });

  it.each([
    ['porcentagem acima de 100%', { value: 10_001 }],
    [
      'fim antes do início',
      { startsAt: '2026-12-01T00:00:00Z', expiresAt: '2026-11-01T00:00:00Z' },
    ],
    ['nenhum produto escolhido', { productIds: [] }],
  ])('recusa %s', async (_label, change) => {
    await expect(
      service.create('company-a', { ...coupon, ...change }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cupom para todos os produtos ignora a lista', async () => {
    await service.create('company-a', {
      ...coupon,
      appliesToAllProducts: true,
    });
    const links = (
      tx.checkoutCouponProduct.createMany.mock.calls as [LinksArg][]
    )[0]?.[0] as LinksArg;
    expect(links.data).toEqual([]);
  });

  it('versão antiga responde VERSION_CHANGED sem trocar os produtos', async () => {
    tx.checkoutCoupon.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.update('company-a', 'coupon-1', {
        ...coupon,
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CHANGED' } });
    expect(tx.checkoutCouponProduct.deleteMany).not.toHaveBeenCalled();
  });
});
