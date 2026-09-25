import { PrismaService } from '../prisma/prisma.service';
import { PaymentFeeService } from '../payment-fees/payment-fee.service';
import { PaymentChargeService } from './payment-charge.service';
import { Prisma } from '@prisma/client';
import type { IssuanceContext } from '../financial-activation/financial-eligibility.service';

const financial: IssuanceContext = {
  financialProfileId: 'profile-1',
  issuerIdentityId: 'identity-1',
  issuerCredentialVersionId: 'credential-1',
  accountMode: 'CUSTOMER_ACCOUNT',
  payoutMode: 'DIRECT_TO_CUSTOMER',
  financialEnvironment: 'PRODUCTION',
};

function fixture(
  status = 'ACTIVE',
  effectiveEfiFeeCents: number | null = null,
) {
  const row = {
    id: 'charge-1',
    companyId: 'company-1',
    invoiceId: 'invoice-1',
    status,
    grossAmountCents: 10000,
    gatewayId: 'gateway-1',
    efiTxid: 'gateway-1',
    efiChargeId: null,
    gatewayStatusRaw: 'partially_refunded',
    estimatedEfiFeeCents: 100,
    estimatedPlatformFeeCents: 250,
    effectivePlatformFeeCents: null,
    effectiveEfiFeeCents,
    paidAt: status === 'PAID' ? new Date('2026-01-01') : null,
  };
  const tx = {
    // Company pointer first (FOR SHARE), then the invoice (FOR UPDATE).
    $queryRaw: jest.fn((sql: Prisma.Sql) =>
      Promise.resolve(
        sql.text.includes('"Company"')
          ? [{ activeFinancialProfileId: 'profile-1' }]
          : [
              {
                id: 'invoice-1',
                status: 'DRAFT',
                lateFineBasisPoints: 200,
                lateInterestMonthlyBasisPoints: 100,
                paymentDaysAfterDue: 30,
              },
            ],
      ),
    ),
    paymentCharge: {
      findFirst: jest.fn().mockResolvedValue(row),
      create: jest.fn().mockResolvedValue(row),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    paymentChargeStatusHistory: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    invoice: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    collectionLog: { create: jest.fn() },
    paymentFeeVersion: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'fee-1' }),
    },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(
      (fn: (client: Prisma.TransactionClient) => Promise<unknown>) =>
        fn(tx as unknown as Prisma.TransactionClient),
    ),
  };
  const fees = {
    resolveActiveVersion: jest
      .fn()
      .mockResolvedValue({ id: 'fee-1', platformFeeBasisPoints: 250 }),
    calculateQuote: jest.fn((gross: number) => ({
      estimatedEfiFeeCents: 100,
      estimatedPlatformFeeCents: Math.round(gross * 0.025),
    })),
    toSnapshot: jest.fn().mockReturnValue({ version: 3 }),
    hasEffectiveFeeDivergence: jest.fn().mockReturnValue(true),
  };
  return {
    tx,
    row,
    fees,
    service: new PaymentChargeService(
      prisma as unknown as PrismaService,
      fees as unknown as PaymentFeeService,
    ),
  };
}

describe('PaymentChargeService', () => {
  it('restricts refund invoice effects to the current provider charge', async () => {
    const { service, tx, row } = fixture('PAID');
    await service.recordPixRefunds(row, [
      { providerRefundId: 'one', amountCents: 10000 },
    ]);
    const updateMany = tx.invoice.updateMany as jest.Mock<unknown, [unknown]>;
    const update = updateMany.mock.calls[0]?.[0] as {
      where: { OR: Prisma.InvoiceWhereInput[] };
    };
    expect(update.where.OR).toContainEqual({ gatewayId: 'gateway-1' });
  });
  it('settles invoice and charge in one transaction with invoice locked first', async () => {
    const { service, tx, row } = fixture('ACTIVE');
    await service.recordSettlement(row, 120, 'paid');
    const queryRaw = tx.$queryRaw as jest.Mock<Promise<unknown>, [Prisma.Sql]>;
    const lock = queryRaw.mock.calls[0]?.[0];
    expect(lock?.text).toContain('"Invoice"');
    expect(tx.invoice.updateMany).toHaveBeenCalled();
  });
  it('retains partial refund state when a later actual fee arrives', async () => {
    const { service, tx, row } = fixture('PAID');
    await service.recordSettlement(row, 120, 'paid');
    expect(tx.paymentCharge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          gatewayStatusRaw: 'partially_refunded',
          effectiveEfiFeeCents: 120,
        }) as unknown,
      }),
    );
  });
  it('reflects boleto refunds atomically on the owning invoice', async () => {
    const { service, tx } = fixture('PAID');
    await service.transition(
      'charge-1',
      'company-1',
      'REFUNDED',
      { gatewayStatusRaw: 'refunded' },
      'refunded',
    );
    expect(tx.invoice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.any(Array) as unknown,
        }) as unknown,
        data: { status: 'CANCELED', gatewayStatusRaw: 'refunded' },
      }),
    );
  });
  it('deduplicates partial refund events and accumulates a later full refund', async () => {
    const { service, tx, row } = fixture('PAID');
    tx.paymentChargeStatusHistory.findMany.mockResolvedValue([
      { sanitizedDetails: { providerRefundId: 'one', amountCents: 4000 } },
    ]);
    await expect(
      service.recordPixRefunds(row, [
        { providerRefundId: 'one', amountCents: 4000 },
        { providerRefundId: 'two', amountCents: 6000 },
      ]),
    ).resolves.toBe('REFUNDED');
    expect(tx.paymentChargeStatusHistory.create).toHaveBeenCalledTimes(1);
    expect(tx.invoice.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'invoice-1',
        companyId: 'company-1',
      }) as unknown,
      data: { status: 'CANCELED', gatewayStatusRaw: 'refunded' },
    });
  });
  it('keeps a partially refunded invoice paid without emitting another payment', async () => {
    const { service, tx, row } = fixture('PAID');
    await expect(
      service.recordPixRefunds(row, [
        { providerRefundId: 'one', amountCents: 4000 },
      ]),
    ).resolves.toBe('PAID');
    expect(tx.invoice.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'invoice-1',
        companyId: 'company-1',
      }) as unknown,
      data: { status: 'PAID', gatewayStatusRaw: 'partially_refunded' },
    });
  });
  it('rejects an invoice settled before the reservation acquired its lock', async () => {
    const { service, tx } = fixture();
    tx.$queryRaw
      .mockResolvedValueOnce([{ activeFinancialProfileId: 'profile-1' }])
      .mockResolvedValueOnce([
        {
          id: 'invoice-1',
          status: 'PAID',
          lateFineBasisPoints: 0,
          lateInterestMonthlyBasisPoints: 0,
          paymentDaysAfterDue: 30,
        },
      ]);
    tx.paymentCharge.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.createDraft('company-1', 'invoice-1', 'PIX', 10000, financial),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.paymentCharge.create).not.toHaveBeenCalled();
  });
  it('locks the invoice and snapshots fees before reserving an issuance', async () => {
    const { service, tx } = fixture();
    tx.paymentCharge.findFirst.mockResolvedValueOnce(null);
    await service.createDraft(
      'company-1',
      'invoice-1',
      'PIX',
      10000,
      financial,
    );
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.paymentCharge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'PENDING',
        feeSnapshot: { version: 3 },
        efiTxid: expect.stringMatching(/^[a-f0-9]{32}$/) as unknown,
      }) as unknown,
    });
  });
  it('fixes the issuer account, modes and late terms on the charge', async () => {
    const { service, tx } = fixture();
    tx.paymentCharge.findFirst.mockResolvedValueOnce(null);
    await service.createDraft(
      'company-1',
      'invoice-1',
      'BOLIX',
      10000,
      financial,
    );
    expect(tx.paymentCharge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        financialProfileId: 'profile-1',
        issuerIdentityId: 'identity-1',
        issuerCredentialVersionId: 'credential-1',
        accountMode: 'CUSTOMER_ACCOUNT',
        payoutMode: 'DIRECT_TO_CUSTOMER',
        financialEnvironment: 'PRODUCTION',
        distributionSnapshot: expect.objectContaining({
          grossAmountCents: 10000,
          estimatedPlatformFeeCents: 250,
        }) as unknown,
        lateFineBasisPoints: 200,
        lateInterestMonthlyBasisPoints: 100,
        paymentDaysAfterDue: 30,
      }) as unknown,
    });
  });
  it('refuses the reservation when the active profile changed meanwhile', async () => {
    const { service, tx } = fixture();
    tx.$queryRaw.mockResolvedValueOnce([
      { activeFinancialProfileId: 'profile-2' },
    ]);
    await expect(
      service.createDraft('company-1', 'invoice-1', 'PIX', 10000, financial),
    ).rejects.toMatchObject({
      response: { code: 'FINANCIAL_PROFILE_CHANGED' },
    });
    expect(tx.paymentCharge.create).not.toHaveBeenCalled();
  });
  it('rejects legacy billing methods for new charges', async () => {
    const { service, tx } = fixture();
    await expect(
      service.createDraft('company-1', 'invoice-1', 'BOLETO', 10000, financial),
    ).rejects.toMatchObject({ status: 403 });
    expect(tx.paymentCharge.create).not.toHaveBeenCalled();
  });
  it('charges the platform fee on the amount actually paid', async () => {
    const { service, tx, row } = fixture();
    await service.recordSettlement(row, 120, 'paid', 10500);
    expect(tx.paymentCharge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paidAmountCents: 10500,
          effectivePlatformFeeCents: 263,
        }) as unknown,
      }),
    );
  });
  it('rejects an invalid paid amount before any write', async () => {
    const { service, tx, row } = fixture();
    await expect(
      service.recordSettlement(row, null, 'paid', 0),
    ).rejects.toMatchObject({ status: 400 });
    expect(tx.paymentCharge.updateMany).not.toHaveBeenCalled();
  });
  it('blocks a concurrent reservation even for a different billing method', async () => {
    const { service, tx } = fixture();
    await expect(
      service.createDraft('company-1', 'invoice-1', 'BOLIX', 10000, financial),
    ).rejects.toThrow();
    expect(tx.paymentCharge.create).not.toHaveBeenCalled();
  });
  it.each([
    ['PAID', 'CANCELED', 'PAID'],
    ['REFUNDED', 'PAID', 'REFUNDED'],
    ['REPLACED', 'EXPIRED', 'REPLACED'],
  ] as const)(
    'does not regress %s on %s',
    async (before, incoming, expected) => {
      const { service, tx } = fixture(before);
      await service.transition('charge-1', 'company-1', incoming, {});
      expect(tx.paymentCharge.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: expected }) as unknown,
        }),
      );
      expect(tx.paymentChargeStatusHistory.create).not.toHaveBeenCalled();
    },
  );
  it('records a payment and divergence exactly once', async () => {
    const { service, tx } = fixture();
    await service.recordSettlement(
      {
        id: 'charge-1',
        companyId: 'company-1',
        invoiceId: 'invoice-1',
        estimatedEfiFeeCents: 100,
      },
      120,
      'paid',
    );
    expect(tx.paymentChargeStatusHistory.create).toHaveBeenCalledTimes(1);
    expect(tx.collectionLog.create).toHaveBeenCalledTimes(1);
  });
  it('promotes the snapshotted platform fee to effective on settlement', async () => {
    const { service, tx, row } = fixture();
    await service.recordSettlement(row, 120, 'paid');
    expect(tx.paymentCharge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          effectiveEfiFeeCents: 120,
          effectivePlatformFeeCents: 250,
        }) as unknown,
      }),
    );
  });
  it('preserves effective fees and payment date on duplicate notifications without fees', async () => {
    const { service, tx, row } = fixture('PAID', 120);
    await service.recordSettlement(
      {
        id: 'charge-1',
        companyId: 'company-1',
        invoiceId: 'invoice-1',
        estimatedEfiFeeCents: 100,
      },
      null,
      'paid',
    );
    expect(tx.paymentCharge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paidAt: row.paidAt,
          effectiveEfiFeeCents: 120,
        }) as unknown,
      }),
    );
    expect(tx.collectionLog.create).not.toHaveBeenCalled();
  });
  it('ignores a delayed settlement after refund', async () => {
    const { service, tx } = fixture('REFUNDED');
    await service.recordSettlement(
      {
        id: 'charge-1',
        companyId: 'company-1',
        invoiceId: 'invoice-1',
        estimatedEfiFeeCents: 100,
      },
      120,
      'paid',
    );
    expect(tx.paymentCharge.updateMany).not.toHaveBeenCalled();
    expect(tx.collectionLog.create).not.toHaveBeenCalled();
  });
});
