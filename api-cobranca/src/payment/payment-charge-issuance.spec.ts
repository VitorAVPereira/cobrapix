import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentFeeService } from '../payment-fees/payment-fee.service';
import { PaymentChargeService } from './payment-charge.service';

jest.mock('../settlements/settlement-ledger', () => ({
  syncSettlement: jest.fn(),
  recordDuplicatePayment: jest.fn(),
}));

function fixture(status: string, efiChargeId: string | null = '555') {
  const row = {
    id: 'charge-1',
    companyId: 'company-1',
    invoiceId: 'invoice-1',
    billingMethod: 'BOLIX',
    status,
    grossAmountCents: 500,
    gatewayId: efiChargeId,
    efiTxid: null,
    efiChargeId,
    efiLocId: null,
    splitConfigId: null,
    gatewayStatusRaw: null,
    issuedAt: null,
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    paymentCharge: {
      findFirst: jest.fn().mockResolvedValue(row),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    paymentChargeStatusHistory: { create: jest.fn() },
    invoice: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    collectionLog: { create: jest.fn() },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(
      (fn: (client: Prisma.TransactionClient) => Promise<unknown>) =>
        fn(tx as unknown as Prisma.TransactionClient),
    ),
  };
  return {
    tx,
    service: new PaymentChargeService(
      prisma as unknown as PrismaService,
      {} as PaymentFeeService,
    ),
  };
}

const confirmation = {
  source: 'RECONCILIATION' as const,
  billingMethod: 'BOLIX' as const,
  gatewayId: '555',
  providerChargeId: '555',
  boletoCode: '0019',
  boletoLink: 'https://boleto.example.test',
  boletoPdf: 'https://boleto.example.test/pdf',
  pixCopyPaste: '000201bolix',
  paymentLink: 'https://boleto.example.test',
  expiresAt: new Date('2026-10-11T00:00:00.000Z'),
  providerStatus: 'waiting',
};

describe('PaymentChargeService issuance outcome', () => {
  it('confirms the charge, the invoice instruments and the history in one transaction', async () => {
    const { service, tx } = fixture('PENDING');
    await expect(
      service.confirmIssuance('company-1', 'charge-1', confirmation),
    ).resolves.toBe('ACTIVE');
    // Invoice, then charge: the lock order of every other charge write.
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.paymentCharge.updateMany).toHaveBeenCalledWith({
      where: { id: 'charge-1', companyId: 'company-1', status: 'PENDING' },
      data: expect.objectContaining({
        status: 'ACTIVE',
        efiChargeId: '555',
        boletoLine: '0019',
        pixPayload: '000201bolix',
        issuedAt: expect.any(Date) as unknown,
      }) as unknown,
    });
    expect(tx.invoice.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'invoice-1',
        companyId: 'company-1',
        status: { in: ['DRAFT', 'PENDING'] },
      },
      data: expect.objectContaining({
        billingType: 'BOLIX',
        efiChargeId: '555',
        boletoLinhaDigitavel: '0019',
        efiPixCopiaECola: '000201bolix',
      }) as unknown,
    });
    expect(tx.paymentChargeStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        previousStatus: 'PENDING',
        status: 'ACTIVE',
        sanitizedDetails: {
          event: 'ISSUANCE_CONFIRMED',
          source: 'RECONCILIATION',
        },
      }) as unknown,
    });
    expect(tx.collectionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actionType: 'EFI_ISSUANCE_RECOVERED',
      }) as unknown,
    });
  });

  it('never reopens a charge a webhook settled meanwhile', async () => {
    const { service, tx } = fixture('PAID');
    await expect(
      service.confirmIssuance('company-1', 'charge-1', confirmation),
    ).resolves.toBe('ALREADY_FINALIZED');
    expect(tx.paymentCharge.updateMany).not.toHaveBeenCalled();
    expect(tx.invoice.updateMany).not.toHaveBeenCalled();
  });

  it('treats a second confirmation of the same issuance as done', async () => {
    const { service, tx } = fixture('ACTIVE');
    await expect(
      service.confirmIssuance('company-1', 'charge-1', confirmation),
    ).resolves.toBe('ACTIVE');
    expect(tx.paymentCharge.updateMany).not.toHaveBeenCalled();
    expect(tx.paymentChargeStatusHistory.create).not.toHaveBeenCalled();
  });

  it('refuses instruments of another provider charge or modality', async () => {
    const { service, tx } = fixture('PENDING');
    await expect(
      service.confirmIssuance('company-1', 'charge-1', {
        ...confirmation,
        providerChargeId: '999',
      }),
    ).rejects.toMatchObject({
      response: { code: 'PROVIDER_REFERENCE_MISMATCH' },
    });
    await expect(
      service.confirmIssuance('company-1', 'charge-1', {
        ...confirmation,
        billingMethod: 'BOLETO',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.paymentCharge.updateMany).not.toHaveBeenCalled();
  });

  it('releases a proven refusal and records only the sanitized diagnosis', async () => {
    const { service, tx } = fixture('PENDING', null);
    await expect(
      service.recordIssuanceFailure('charge-1', 'company-1', {
        kind: 'REJECTED',
        code: 'EFI_VALIDATION_REJECTED',
        stage: 'PROVIDER_REQUEST',
        httpStatus: null,
        providerCode: 'validation_error:3500034',
        field: '/payment/banking_billet/customer/phone_number',
        message: 'A Efí recusou os dados da cobrança: telefone do pagador.',
      }),
    ).resolves.toBe('FAILED');
    expect(tx.paymentCharge.updateMany).toHaveBeenCalledWith({
      where: { id: 'charge-1', companyId: 'company-1', status: 'PENDING' },
      data: { status: 'FAILED' },
    });
    expect(tx.paymentChargeStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        previousStatus: 'PENDING',
        status: 'FAILED',
        sanitizedDetails: expect.objectContaining({
          event: 'ISSUANCE_FAILURE',
          kind: 'REJECTED',
          code: 'EFI_VALIDATION_REJECTED',
          field: '/payment/banking_billet/customer/phone_number',
        }) as unknown,
      }) as unknown,
    });
  });

  it('keeps an uncertain outcome reserved, recording the diagnosis alone', async () => {
    const { service, tx } = fixture('PENDING', null);
    await expect(
      service.recordIssuanceFailure('charge-1', 'company-1', {
        kind: 'UNCERTAIN',
        code: 'EFI_SUBMISSION_UNCERTAIN',
        stage: 'PROVIDER_REQUEST',
        httpStatus: null,
        providerCode: 'net:ECONNRESET',
        field: null,
        message: 'incerta',
      }),
    ).resolves.toBe('PENDING');
    expect(tx.paymentCharge.updateMany).not.toHaveBeenCalled();
    expect(tx.paymentChargeStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        previousStatus: 'PENDING',
        status: 'PENDING',
      }) as unknown,
    });
  });

  it('does not fail an absence once a provider reference is known', async () => {
    const { service, tx } = fixture('PENDING', '555');
    await expect(
      service.recordReconciliation('charge-1', 'company-1', {
        reasonCode: 'PROVIDER_NOT_FOUND',
        fail: true,
      }),
    ).resolves.toBe('PENDING');
    expect(tx.paymentCharge.updateMany).not.toHaveBeenCalled();
  });

  it('attaches a provider reference only to an open reservation', async () => {
    const { service, tx } = fixture('FAILED', null);
    await expect(
      service.attachProviderReference('charge-1', 'company-1', '555'),
    ).rejects.toMatchObject({ response: { code: 'ISSUANCE_NOT_OPEN' } });
    expect(tx.paymentCharge.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a provider reference already linked to another charge', async () => {
    const { service, tx } = fixture('PENDING', null);
    tx.paymentCharge.updateMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(
      service.attachProviderReference('charge-1', 'company-1', '555'),
    ).rejects.toMatchObject({
      response: { code: 'PROVIDER_REFERENCE_MISMATCH' },
    });
  });
});
