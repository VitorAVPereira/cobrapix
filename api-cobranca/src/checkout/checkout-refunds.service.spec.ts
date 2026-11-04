import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ResendMailerService } from '../common/resend-mailer.service';
import {
  CheckoutLedgerService,
  RELEASE_DELAY_MS,
} from './checkout-ledger.service';
import { CheckoutRefundsService } from './checkout-refunds.service';
import type { CheckoutWebhooksService } from './checkout-webhooks.service';

interface EntryArg {
  data: Array<{
    kind: string;
    amountCents: number;
    idempotencyKey: string;
    availableAt: Date;
  }>;
}

const now = new Date('2026-11-05T15:00:00Z');

describe('CheckoutLedgerService.recordSale', () => {
  it('grava venda, tarifa real e % Cifra+, liberados em 7 dias, uma vez só', async () => {
    const createMany = jest.fn();
    const ledger = new CheckoutLedgerService({} as PrismaService);
    const paidAt = new Date('2026-11-01T12:00:00Z');

    await ledger.recordSale(
      { checkoutLedgerEntry: { createMany } } as unknown as PrismaService,
      {
        id: 'o1',
        companyId: 'c1',
        totalCents: 6700,
        efiFeeCents: 80,
        platformFeeCents: 168,
        paidAt,
      },
      79,
    );

    const arg = (
      createMany.mock.calls as [EntryArg & { skipDuplicates: boolean }][]
    )[0]?.[0];
    expect(arg?.skipDuplicates).toBe(true);
    expect(
      arg?.data.map((entry) => [
        entry.kind,
        entry.amountCents,
        entry.idempotencyKey,
      ]),
    ).toEqual([
      ['SALE', 6700, 'sale:o1'],
      ['EFI_FEE', -79, 'efi-fee:o1'],
      ['PLATFORM_FEE', -168, 'platform-fee:o1'],
    ]);
    expect(arg?.data[0]?.availableAt).toEqual(
      new Date(paidAt.getTime() + RELEASE_DELAY_MS),
    );
  });
});

describe('CheckoutRefundsService', () => {
  const tx = {
    $queryRaw: jest.fn(),
    checkoutOrder: { findUnique: jest.fn(), update: jest.fn() },
    checkoutRefundRequest: { updateMany: jest.fn() },
  };
  const prisma = {
    checkoutOrder: { findUnique: jest.fn(), findFirst: jest.fn() },
    checkoutRefundRequest: {
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    company: { findUnique: jest.fn() },
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const ledger = { record: jest.fn() };
  const mailer = { sendEmail: jest.fn() };
  const webhooks = { emit: jest.fn() };
  const env: Record<string, string> = {
    PLATFORM_ALERT_EMAIL: 'alertas@ciframais.test',
    RESEND_API_KEY: 're_test',
    RESEND_FROM_EMAIL: 'Cifra+ <nao-responda@ciframais.test>',
  };
  const service = new CheckoutRefundsService(
    prisma as unknown as PrismaService,
    ledger as unknown as CheckoutLedgerService,
    { get: (key: string) => env[key] } as unknown as ConfigService,
    mailer as unknown as ResendMailerService,
    webhooks as unknown as CheckoutWebhooksService,
  );
  const order = (
    entries: Array<{
      kind: string;
      amountCents: number;
      idempotencyKey: string;
    }> = [],
  ) => ({
    id: 'o1',
    companyId: 'c1',
    status: 'PAID',
    totalCents: 6700,
    platformFeeCents: 168,
    ledgerEntries: entries,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    tx.checkoutOrder.findUnique.mockResolvedValue(order());
    prisma.checkoutRefundRequest.findFirst.mockResolvedValue(null);
    prisma.checkoutRefundRequest.create.mockResolvedValue({
      id: 'r1',
      status: 'REQUESTED',
    });
  });

  it('devolução total: sai do saldo, a % Cifra+ volta e o pedido fica reembolsado', async () => {
    await expect(
      service.record(
        {
          orderId: 'o1',
          amountCents: 6700,
          idempotencyKey: 'pix:E1:D1',
          fromProvider: true,
        },
        now,
      ),
    ).resolves.toBe(true);

    const entries = (
      ledger.record.mock.calls as [unknown, EntryArg['data']][]
    )[0]?.[1];
    expect(entries?.map((entry) => [entry.kind, entry.amountCents])).toEqual([
      ['REFUND', -6700],
      ['PLATFORM_FEE_REVERSAL', 168],
    ]);
    expect(tx.checkoutOrder.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { status: 'REFUNDED' },
    });
    expect(tx.checkoutRefundRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderId: 'o1', status: 'REQUESTED' },
      }),
    );
  });

  it('devoluções parciais devolvem a % aos poucos, sem passar do total', async () => {
    tx.checkoutOrder.findUnique.mockResolvedValue(
      order([
        { kind: 'REFUND', amountCents: -3350, idempotencyKey: 'refund:a' },
        {
          kind: 'PLATFORM_FEE_REVERSAL',
          amountCents: 84,
          idempotencyKey: 'fee-reversal:a',
        },
      ]),
    );
    await service.record(
      {
        orderId: 'o1',
        amountCents: 3350,
        idempotencyKey: 'b',
        fromProvider: true,
      },
      now,
    );

    const entries = (
      ledger.record.mock.calls as [unknown, EntryArg['data']][]
    )[0]?.[1];
    expect(
      entries?.find((entry) => entry.kind === 'PLATFORM_FEE_REVERSAL')
        ?.amountCents,
    ).toBe(84);
    expect(tx.checkoutOrder.update).toHaveBeenCalled();
  });

  it('a mesma devolução avisada duas vezes não conta de novo', async () => {
    tx.checkoutOrder.findUnique.mockResolvedValue(
      order([
        {
          kind: 'REFUND',
          amountCents: -1000,
          idempotencyKey: 'refund:pix:E1:D1',
        },
      ]),
    );
    await expect(
      service.record(
        {
          orderId: 'o1',
          amountCents: 1000,
          idempotencyKey: 'pix:E1:D1',
          fromProvider: true,
        },
        now,
      ),
    ).resolves.toBe(false);
    expect(ledger.record).not.toHaveBeenCalled();
  });

  it('registro manual não devolve mais do que foi pago', async () => {
    await expect(
      service.record(
        {
          orderId: 'o1',
          amountCents: 6701,
          idempotencyKey: 'm1',
          fromProvider: false,
        },
        now,
      ),
    ).rejects.toMatchObject({ response: { code: 'CHECKOUT_REFUND_TOO_HIGH' } });
  });

  it('comprador pede dentro de 7 dias e o admin é avisado', async () => {
    prisma.checkoutOrder.findUnique.mockResolvedValue({
      id: 'o1',
      companyId: 'c1',
      status: 'PAID',
      paidAt: new Date(now.getTime() - 6 * 86_400_000),
    });
    prisma.company.findUnique.mockResolvedValue({ corporateName: 'Porquim' });

    await service.requestByBuyer('tok', 'Não era o que eu esperava', now);

    expect(prisma.checkoutRefundRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          origin: 'BUYER',
          orderId: 'o1',
        }) as unknown,
      }),
    );
    expect(mailer.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['alertas@ciframais.test'] }),
    );
  });

  it('depois de 7 dias o link não aceita e orienta a falar com o vendedor', async () => {
    prisma.checkoutOrder.findUnique.mockResolvedValue({
      id: 'o1',
      companyId: 'c1',
      status: 'PAID',
      paidAt: new Date(now.getTime() - 8 * 86_400_000),
    });
    await expect(
      service.requestByBuyer('tok', 'Mudei de ideia', now),
    ).rejects.toMatchObject({
      response: { code: 'CHECKOUT_REFUND_WINDOW_CLOSED' },
    });
  });

  it('um pedido aberto por venda; venda de outra empresa responde 404', async () => {
    prisma.checkoutOrder.findFirst.mockResolvedValue({
      id: 'o1',
      companyId: 'c1',
      status: 'PAID',
    });
    prisma.checkoutRefundRequest.findFirst.mockResolvedValue({ id: 'r0' });
    await expect(
      service.requestBySeller('c1', 'o1', 'Cliente pediu'),
    ).rejects.toMatchObject({
      response: { code: 'CHECKOUT_REFUND_ALREADY_REQUESTED' },
    });

    prisma.checkoutOrder.findFirst.mockResolvedValue(null);
    await expect(
      service.requestBySeller('c2', 'o1', 'Cliente pediu'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('e-mail do alerta falhando não perde o pedido', async () => {
    prisma.checkoutOrder.findFirst.mockResolvedValue({
      id: 'o1',
      companyId: 'c1',
      status: 'PAID',
    });
    mailer.sendEmail.mockRejectedValueOnce(new Error('resend down'));
    await expect(
      service.requestBySeller('c1', 'o1', 'Cliente pediu'),
    ).resolves.toMatchObject({ id: 'r1' });
  });
});
