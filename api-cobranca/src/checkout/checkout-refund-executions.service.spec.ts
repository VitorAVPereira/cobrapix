import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ResendMailerService } from '../common/resend-mailer.service';
import type { CheckoutPlatformService } from './checkout-platform.service';
import type { CheckoutRefundsService } from './checkout-refunds.service';
import type { EfiCheckoutCardClient } from './efi-checkout-card.client';
import type { EfiCheckoutRefundClient } from './efi-checkout-refund.client';
import { CheckoutRefundExecutionsService } from './checkout-refund-executions.service';

const now = new Date('2026-11-20T12:00:00Z');

describe('CheckoutRefundExecutionsService', () => {
  const tx = {
    checkoutRefundExecution: { create: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    checkoutOrder: { findFirst: jest.fn(), findUnique: jest.fn() },
    checkoutRefundExecution: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    checkoutPaymentAttempt: { findUnique: jest.fn() },
    checkoutCardAttempt: { findFirst: jest.fn() },
    checkoutRefundRequest: { findMany: jest.fn() },
    company: { findUnique: jest.fn() },
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const platform = { accountOf: jest.fn() };
  const refunds = { record: jest.fn() };
  const client = { pix: jest.fn(), pixStatus: jest.fn(), card: jest.fn() };
  const cards = { detail: jest.fn() };
  const mailer = { sendEmail: jest.fn() };
  const env: Record<string, string> = {
    RESEND_API_KEY: 're_test',
    RESEND_FROM_EMAIL: 'Cifra+ <nao-responda@ciframais.test>',
  };
  const service = new CheckoutRefundExecutionsService(
    prisma as unknown as PrismaService,
    platform as unknown as CheckoutPlatformService,
    refunds as unknown as CheckoutRefundsService,
    client as unknown as EfiCheckoutRefundClient,
    cards as unknown as EfiCheckoutCardClient,
    { get: (key: string) => env[key] } as unknown as ConfigService,
    mailer as unknown as ResendMailerService,
  );
  const account = { identity: { id: 'identity-seller' } };
  const sale = (change: object = {}) => ({
    id: 'order-1',
    companyId: 'company-a',
    status: 'PAID',
    paymentMethod: 'PIX',
    totalCents: 10000,
    terms: { accountMode: 'SELLER_ACCOUNT' },
    attempt: { issuerIdentityId: 'identity-seller', endToEndId: 'E2E1' },
    cardAttempts: [],
    refundRequests: [{ id: 'request-1', amountCents: null }],
    ledgerEntries: [],
    ...change,
  });
  const execution = (change: object = {}) => ({
    id: 'execution-1',
    companyId: 'company-a',
    refundRequestId: 'request-1',
    orderId: 'order-1',
    method: 'PIX',
    amountCents: 10000,
    status: 'SUBMITTING',
    efiRefundId: 'ckr0123456789abcdef0123456789abcdef',
    issuerIdentityId: 'identity-seller',
    origin: 'SELLER',
    requestedByUserId: 'user-1',
    createdAt: now,
    ...change,
  });
  const seller = { origin: 'SELLER' as const, userId: 'user-1' };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.checkoutOrder.findFirst.mockResolvedValue(sale());
    tx.checkoutRefundExecution.create.mockImplementation(
      ({ data }: { data: object }) => ({ ...execution(), ...data }),
    );
    platform.accountOf.mockResolvedValue(account);
    prisma.checkoutRefundExecution.updateMany.mockResolvedValue({ count: 1 });
    prisma.checkoutPaymentAttempt.findUnique.mockResolvedValue({
      endToEndId: 'E2E1',
    });
    prisma.company.findUnique.mockResolvedValue({ email: 'loja@exemplo.test' });
    prisma.checkoutRefundExecution.findFirst.mockResolvedValue({
      id: 'execution-1',
      status: 'DONE',
      failureCode: null,
    });
  });

  it('Pix: grava a execução antes de chamar a Efí e lança pela mesma chave do aviso de devolução', async () => {
    const calls: string[] = [];
    tx.checkoutRefundExecution.create.mockImplementation(
      ({ data }: { data: object }) => {
        calls.push('save');
        return { ...execution(), ...data };
      },
    );
    client.pix.mockImplementation(() => {
      calls.push('efi');
      return { outcome: 'DONE' };
    });

    await service.execute('company-a', 'order-1', seller, now);

    expect(calls).toEqual(['save', 'efi']);
    const data = (
      tx.checkoutRefundExecution.create.mock.calls[0] as [
        { data: { efiRefundId: string } },
      ]
    )[0].data;
    expect(data).toMatchObject({
      companyId: 'company-a',
      refundRequestId: 'request-1',
      method: 'PIX',
      amountCents: 10000,
      issuerIdentityId: 'identity-seller',
      origin: 'SELLER',
    });
    // The Efí accepts letters and digits, up to 35.
    expect(data.efiRefundId).toMatch(/^[A-Za-z0-9]{1,35}$/);
    expect(client.pix).toHaveBeenCalledWith(
      account,
      'E2E1',
      data.efiRefundId,
      10000,
    );
    expect(refunds.record).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        amountCents: 10000,
        idempotencyKey: `pix:E2E1:${data.efiRefundId}`,
        fromProvider: true,
      }),
      now,
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'CHECKOUT_REFUND_EXECUTION_STARTED',
      }) as unknown,
    });
  });

  it('duplo clique: a segunda execução não sai, a Efí é chamada uma vez', async () => {
    tx.checkoutRefundExecution.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    prisma.checkoutRefundExecution.findFirst.mockResolvedValue({
      id: 'execution-1',
      status: 'PROCESSING',
      failureCode: null,
    });
    await expect(
      service.execute('company-a', 'order-1', seller, now),
    ).resolves.toMatchObject({
      status: 'PROCESSING',
      message: 'Reembolso em processamento na Efí.',
    });
    expect(client.pix).not.toHaveBeenCalled();
  });

  it('recusa certa (sem saldo): falha com o motivo, o pedido continua aberto e o vendedor recebe e-mail', async () => {
    client.pix.mockResolvedValue({
      outcome: 'REJECTED',
      code: 'EFI_REJECTED_SALDO_INSUFICIENTE',
    });
    await service.execute('company-a', 'order-1', seller, now);

    expect(prisma.checkoutRefundExecution.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'execution-1',
        status: { in: ['SUBMITTING', 'PROCESSING', 'UNCERTAIN'] },
      },
      data: {
        status: 'FAILED',
        failureCode: 'EFI_REJECTED_SALDO_INSUFICIENTE',
        completedAt: now,
      },
    });
    expect(refunds.record).not.toHaveBeenCalled();
    const mail = (
      mailer.sendEmail.mock.calls[0] as [{ to: string[]; html: string }]
    )[0];
    expect(mail.to).toEqual(['loja@exemplo.test']);
    expect(mail.html).toContain('sem saldo na conta');
  });

  it('resposta perdida: fica incerta; a consulta pelo id conclui, ou depois de 30 min encerra sem lançar', async () => {
    client.pix.mockResolvedValue({ outcome: 'UNCERTAIN' });
    await service.execute('company-a', 'order-1', seller, now);
    expect(prisma.checkoutRefundExecution.updateMany).toHaveBeenCalledWith({
      where: { id: 'execution-1', status: 'SUBMITTING' },
      data: { status: 'UNCERTAIN' },
    });
    expect(refunds.record).not.toHaveBeenCalled();

    jest.clearAllMocks();
    prisma.checkoutRefundExecution.updateMany.mockResolvedValue({ count: 1 });
    prisma.checkoutRefundExecution.findMany.mockResolvedValue([
      execution({ status: 'UNCERTAIN' }),
    ]);
    client.pixStatus.mockResolvedValue({ outcome: 'DONE' });
    await service.reconcileDue(new Date(now.getTime() + 5 * 60_000));
    expect(client.pix).not.toHaveBeenCalled();
    expect(refunds.record).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    prisma.checkoutRefundExecution.updateMany.mockResolvedValue({ count: 1 });
    prisma.checkoutRefundExecution.findMany.mockResolvedValue([
      execution({ status: 'UNCERTAIN' }),
    ]);
    client.pixStatus.mockResolvedValue(null);
    await service.reconcileDue(new Date(now.getTime() + 5 * 60_000));
    expect(prisma.checkoutRefundExecution.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }) as unknown,
      }),
    );
    await service.reconcileDue(new Date(now.getTime() + 31 * 60_000));
    expect(prisma.checkoutRefundExecution.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          failureCode: 'EFI_REFUND_NOT_FOUND',
        }) as unknown,
      }),
    );
    expect(refunds.record).not.toHaveBeenCalled();
  });

  it('admin executa com a referência do ok do vendedor, que fica na execução e na auditoria', async () => {
    client.pix.mockResolvedValue({ outcome: 'PROCESSING' });
    await service.execute(
      'company-a',
      'order-1',
      {
        origin: 'ADMIN',
        userId: 'admin-1',
        approvalReference: ' WhatsApp do João, 21/11 14h10 ',
      },
      now,
    );
    expect(tx.checkoutRefundExecution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        origin: 'ADMIN',
        requestedByUserId: 'admin-1',
        approvalReference: 'WhatsApp do João, 21/11 14h10',
      }) as unknown,
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'admin-1',
        changes: expect.objectContaining({
          approvalReference: 'WhatsApp do João, 21/11 14h10',
        }) as unknown,
      }) as unknown,
    });
    expect(prisma.checkoutRefundExecution.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'execution-1',
        status: { in: ['SUBMITTING', 'PROCESSING', 'UNCERTAIN'] },
      },
      data: { status: 'PROCESSING' },
    });
  });

  it('cartão: estorno total espera a cobrança ficar reembolsada; parcial conclui no aceite', async () => {
    prisma.checkoutOrder.findFirst.mockResolvedValue(
      sale({
        paymentMethod: 'CARD',
        attempt: null,
        cardAttempts: [
          { issuerIdentityId: 'identity-seller', efiChargeId: '991' },
        ],
      }),
    );
    prisma.checkoutOrder.findUnique.mockResolvedValue({
      totalCents: 10000,
      ledgerEntries: [],
    });
    client.card.mockResolvedValue({ outcome: 'PROCESSING' });
    await service.execute('company-a', 'order-1', seller, now);
    expect(client.card).toHaveBeenCalledWith(account, '991', 10000);
    expect(refunds.record).not.toHaveBeenCalled();

    jest.clearAllMocks();
    prisma.checkoutRefundExecution.updateMany.mockResolvedValue({ count: 1 });
    prisma.checkoutRefundExecution.findMany.mockResolvedValue([
      execution({ method: 'CARD', status: 'PROCESSING' }),
    ]);
    prisma.checkoutCardAttempt.findFirst.mockResolvedValue({
      efiChargeId: '991',
    });
    cards.detail.mockResolvedValue({ status: 'refunded' });
    await service.reconcileDue(new Date(now.getTime() + 5 * 60_000));
    expect(refunds.record).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'card:execution-1',
        fromProvider: true,
      }),
      expect.any(Date),
    );

    // A part of the sale: the charge stays "paid", so the acceptance settles it.
    jest.clearAllMocks();
    prisma.checkoutRefundExecution.updateMany.mockResolvedValue({ count: 1 });
    prisma.checkoutOrder.findFirst.mockResolvedValue(
      sale({
        paymentMethod: 'CARD',
        attempt: null,
        cardAttempts: [
          { issuerIdentityId: 'identity-seller', efiChargeId: '991' },
        ],
        refundRequests: [{ id: 'request-1', amountCents: 3000 }],
      }),
    );
    prisma.checkoutOrder.findUnique.mockResolvedValue({
      totalCents: 10000,
      ledgerEntries: [],
    });
    client.card.mockResolvedValue({ outcome: 'PROCESSING' });
    await service.execute('company-a', 'order-1', seller, now);
    expect(refunds.record).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 3000 }),
      now,
    );
  });

  it('fim da espera: o pedido do comprador é devolvido sozinho, uma vez, sem usuário na auditoria', async () => {
    prisma.checkoutRefundRequest.findMany.mockResolvedValue([
      { orderId: 'order-1', companyId: 'company-a' },
    ]);
    client.pix.mockResolvedValue({ outcome: 'DONE' });

    await service.executeDue(now);

    expect(prisma.checkoutRefundRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'REQUESTED',
          origin: 'BUYER',
          holdUntil: { lte: now },
          // Once: after a refusal the seller tries again by hand.
          executions: { none: {} },
          order: { terms: { accountMode: 'SELLER_ACCOUNT' }, status: 'PAID' },
        },
      }),
    );
    expect(tx.checkoutRefundExecution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        origin: 'SYSTEM',
        requestedByUserId: null,
      }) as unknown,
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: null }) as unknown,
    });
    expect(refunds.record).toHaveBeenCalledTimes(1);
  });

  it('fim da espera: uma venda que falha não impede as outras', async () => {
    prisma.checkoutRefundRequest.findMany.mockResolvedValue([
      { orderId: 'order-x', companyId: 'company-a' },
      { orderId: 'order-1', companyId: 'company-a' },
    ]);
    prisma.checkoutOrder.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(sale());
    client.pix.mockResolvedValue({ outcome: 'DONE' });
    await service.executeDue(now);
    expect(client.pix).toHaveBeenCalledTimes(1);
  });

  it('venda de outra empresa, da conta Cifra+, sem pedido aberto ou acima do pago não executa', async () => {
    prisma.checkoutOrder.findFirst.mockResolvedValue(null);
    await expect(
      service.execute('company-b', 'order-1', seller, now),
    ).rejects.toMatchObject({
      status: 404,
    });
    expect(prisma.checkoutOrder.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          id: 'order-1',
          companyId: 'company-b',
          company: { product: 'CHECKOUT' },
        },
      }),
    );
    for (const [change, code] of [
      [
        { terms: { accountMode: 'PLATFORM_ACCOUNT' } },
        'CHECKOUT_ACCOUNT_MODE_NOT_SUPPORTED',
      ],
      [{ refundRequests: [] }, 'CHECKOUT_REFUND_NOT_REQUESTED'],
      [
        { refundRequests: [{ id: 'request-1', amountCents: 20000 }] },
        'CHECKOUT_REFUND_TOO_HIGH',
      ],
      [
        { ledgerEntries: [{ amountCents: -10000 }] },
        'CHECKOUT_REFUND_TOO_HIGH',
      ],
      [{ status: 'REFUNDED' }, 'CHECKOUT_REFUND_NOT_ALLOWED'],
    ] as const) {
      prisma.checkoutOrder.findFirst.mockResolvedValue(sale(change));
      await expect(
        service.execute('company-a', 'order-1', seller, now),
      ).rejects.toMatchObject({
        response: { code },
      });
    }
    expect(tx.checkoutRefundExecution.create).not.toHaveBeenCalled();
    expect(client.pix).not.toHaveBeenCalled();
  });
});
