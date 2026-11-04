import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CheckoutLedgerService } from './checkout-ledger.service';
import type { CheckoutRefundsService } from './checkout-refunds.service';
import { CheckoutFinanceService } from './checkout-finance.service';

const KEY = '0b4f7c2e-8a6d-4f1b-9c3e-2d5a7b8c9e01';

interface RecordCall {
  kind: string;
  amountCents: number;
  idempotencyKey: string;
}

describe('CheckoutFinanceService', () => {
  const tables = {
    company: { count: jest.fn() },
    checkoutOrder: { count: jest.fn(), updateMany: jest.fn() },
    checkoutLedgerEntry: { aggregate: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    ...tables,
    $transaction: jest.fn((run: (client: typeof tables) => unknown) =>
      run(tables),
    ),
  };
  const ledger = {
    record: jest.fn(),
    balance: jest.fn(),
  };
  const refunds = { record: jest.fn() };
  const service = new CheckoutFinanceService(
    prisma as unknown as PrismaService,
    ledger as unknown as CheckoutLedgerService,
    refunds as unknown as CheckoutRefundsService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.company.count.mockResolvedValue(1);
    prisma.checkoutOrder.count.mockResolvedValue(1);
    ledger.balance.mockResolvedValue({
      releasedCents: 5000,
      pendingCents: 0,
      paidOutCents: 0,
      nextReleaseAt: null,
    });
  });

  const recorded = () =>
    (ledger.record.mock.calls as [unknown, RecordCall[]][])[0]?.[1][0];

  it('repasse sai do saldo com a chave da tela e avisa quando passa do liberado', async () => {
    const result = await service.payout('c1', 'admin', {
      idempotencyKey: KEY,
      amountCents: 6000,
      paidOn: '2026-11-05',
      reference: 'E2E-comprovante',
    });

    expect(recorded()).toMatchObject({
      kind: 'PAYOUT',
      amountCents: -6000,
      idempotencyKey: `payout:${KEY}`,
    });
    expect(result.warning).toMatch(/passou do saldo liberado/);
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it('repasse dentro do liberado não avisa', async () => {
    const result = await service.payout('c1', 'admin', {
      idempotencyKey: KEY,
      amountCents: 4000,
      paidOn: '2026-11-05',
    });
    expect(result.warning).toBeNull();
  });

  it('contestação sai do saldo e marca a venda', async () => {
    await service.chargeback('c1', 'admin', {
      idempotencyKey: KEY,
      orderId: 'o1',
      amountCents: 6700,
    });

    expect(recorded()).toMatchObject({
      kind: 'CHARGEBACK',
      amountCents: -6700,
    });
    expect(prisma.checkoutOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'o1',
        companyId: 'c1',
        status: { in: ['PAID', 'REFUNDED'] },
      },
      data: { status: 'CHARGEBACK' },
    });
  });

  it('ajuste aceita valor negativo ou positivo', async () => {
    await service.adjustment('c1', 'admin', {
      idempotencyKey: KEY,
      amountCents: -150,
      note: 'Tarifa de saque',
    });
    expect(recorded()).toMatchObject({ kind: 'ADJUSTMENT', amountCents: -150 });
  });

  it('empresa de cobrança ou venda de outra empresa responde 404', async () => {
    prisma.company.count.mockResolvedValue(0);
    await expect(
      service.payout('billing', 'admin', {
        idempotencyKey: KEY,
        amountCents: 100,
        paidOn: '2026-11-05',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    prisma.checkoutOrder.count.mockResolvedValue(0);
    await expect(
      service.chargeback('c1', 'admin', {
        idempotencyKey: KEY,
        orderId: 'outra',
        amountCents: 100,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(ledger.record).not.toHaveBeenCalled();
  });

  it('índice de chargeback em pontos-base sobre as vendas de 90 dias', async () => {
    prisma.checkoutLedgerEntry.aggregate
      .mockResolvedValueOnce({ _sum: { amountCents: 100_000 }, _count: 20 })
      .mockResolvedValueOnce({ _sum: { amountCents: -1_500 }, _count: 1 });

    await expect(service.chargebackIndex('c1')).resolves.toMatchObject({
      salesCount: 20,
      chargebackCount: 1,
      chargebackCents: 1_500,
      ratioBasisPoints: 150,
    });
  });
});
