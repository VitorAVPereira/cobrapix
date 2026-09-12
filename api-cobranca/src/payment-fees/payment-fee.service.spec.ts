import { HttpException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentFeeService } from './payment-fee.service';

describe('PaymentFeeService', () => {
  it.each([
    ['FIXED', 119, 'FIXED', 50, 169, 'R$ 1,69'],
    ['FIXED', 119, 'PERCENTAGE', 250, 369, 'R$ 1,19 + 2,50%'],
    ['PERCENTAGE', 119, 'FIXED', 50, 169, 'R$ 0,50 + 1,19%'],
    ['PERCENTAGE', 119, 'PERCENTAGE', 250, 369, '3,69%'],
    ['FIXED', 0, 'FIXED', 0, 0, 'R$ 0,00'],
    ['PERCENTAGE', 1, 'PERCENTAGE', 1, 2, '0,02%'],
  ])(
    'quotes %s/%s fee components with commercial rounding',
    (efiKind, efiValue, platformKind, platformValue, expectedFee, label) => {
      const service = new PaymentFeeService({} as PrismaService);
      const quote = service.calculateQuote(10_000, {
        id: 'fee-1',
        billingMethod: 'PIX',
        version: 1,
        efiFeeKind: efiKind as 'FIXED' | 'PERCENTAGE',
        efiFeeAmountCents: efiKind === 'FIXED' ? efiValue : null,
        efiFeeBasisPoints: efiKind === 'PERCENTAGE' ? efiValue : null,
        platformFeeKind: platformKind as 'FIXED' | 'PERCENTAGE',
        platformFeeAmountCents: platformKind === 'FIXED' ? platformValue : null,
        platformFeeBasisPoints:
          platformKind === 'PERCENTAGE' ? platformValue : null,
      });

      expect(quote.totalFeeCents).toBe(expectedFee);
      expect(quote.feeLabel).toBe(label);
      expect(quote.netAmountCents).toBe(10_000 - expectedFee);
    },
  );

  it('rounds each percentage component independently', () => {
    const service = new PaymentFeeService({} as PrismaService);
    const quote = service.calculateQuote(50, {
      id: 'fee-1',
      billingMethod: 'PIX',
      version: 1,
      efiFeeKind: 'PERCENTAGE',
      efiFeeAmountCents: null,
      efiFeeBasisPoints: 100,
      platformFeeKind: 'PERCENTAGE',
      platformFeeAmountCents: null,
      platformFeeBasisPoints: 100,
    });
    expect(quote.totalFeeCents).toBe(2);
  });

  it('blocks a non-positive net amount', () => {
    const service = new PaymentFeeService({} as PrismaService);
    expect(() =>
      service.calculateQuote(100, {
        id: 'fee-1',
        billingMethod: 'BOLETO',
        version: 1,
        efiFeeKind: 'FIXED',
        efiFeeAmountCents: 50,
        efiFeeBasisPoints: null,
        platformFeeKind: 'FIXED',
        platformFeeAmountCents: 50,
        platformFeeBasisPoints: null,
      }),
    ).toThrow(HttpException);
  });

  it('prefers the active company override over the global version', async () => {
    const findFirst = jest.fn().mockResolvedValueOnce({ id: 'company-fee' });
    const service = new PaymentFeeService({
      paymentFeeVersion: { findFirst },
    } as unknown as PrismaService);
    await expect(
      service.resolveActiveVersion('company-1', 'PIX'),
    ).resolves.toEqual({ id: 'company-fee' });
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('falls back to the active global version and fails when neither exists', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'global-fee' });
    const service = new PaymentFeeService({
      paymentFeeVersion: { findFirst },
    } as unknown as PrismaService);
    await expect(
      service.resolveActiveVersion('company-1', 'BOLIX'),
    ).resolves.toEqual({ id: 'global-fee' });
    expect(findFirst).toHaveBeenCalledTimes(2);
  });
});

describe('fee divergence precision', () => {
  it('alerts on eleven cents when five percent is ten and a half cents', () => {
    const service = new PaymentFeeService({} as PrismaService);
    expect(service.hasEffectiveFeeDivergence(210, 221)).toBe(true);
    expect(service.hasEffectiveFeeDivergence(210, 220)).toBe(false);
  });
});
