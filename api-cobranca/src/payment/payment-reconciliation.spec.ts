import { ConfigService } from '@nestjs/config';
import { EfiService } from './efi.service';
import { PaymentChargeService } from './payment-charge.service';
import { PaymentCryptoService } from './payment-crypto.service';
import { PaymentNotificationsService } from './payment-notifications.service';
import { PrismaService } from '../prisma/prisma.service';

interface Reconciler {
  reconcileCharge(
    companyId: string,
    chargeId: string,
    actorId: string,
  ): Promise<{ status: string }>;
}

describe('Uncertain payment reconciliation', () => {
  function fixture(status = 'CONCLUIDA', txid: string | null = 'known-txid') {
    const prisma = {
      paymentCharge: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'charge',
          invoiceId: 'invoice',
          companyId: 'company',
          efiTxid: txid,
          efiChargeId: null,
        }),
      },
      gatewayAccount: {
        findFirst: jest.fn().mockResolvedValue({ companyId: 'company' }),
      },
      auditLog: { create: jest.fn() },
    };
    const charges = {
      recordSettlement: jest.fn().mockResolvedValue(false),
      transition: jest.fn(),
    };
    const sdk = {
      pixDetailDueCharge: jest
        .fn()
        .mockResolvedValue({ txid: 'known-txid', status }),
      detailCharge: jest.fn(),
    };
    const service = new EfiService(
      {} as ConfigService,
      prisma as unknown as PrismaService,
      {} as PaymentCryptoService,
      {} as PaymentNotificationsService,
      null,
      charges as unknown as PaymentChargeService,
    );
    jest
      .spyOn(
        service as unknown as { createSdkClient(): typeof sdk },
        'createSdkClient',
      )
      .mockReturnValue(sdk);
    return { service: service as unknown as Reconciler, prisma, sdk, charges };
  }
  it('uses only the persisted identifier and provider GET to reflect paid state', async () => {
    const { service, sdk, charges, prisma } = fixture();
    await expect(
      service.reconcileCharge('company', 'charge', 'admin'),
    ).resolves.toEqual({ status: 'PAID' });
    expect(sdk.pixDetailDueCharge).toHaveBeenCalledWith({ txid: 'known-txid' });
    expect(prisma.paymentCharge.findFirst).toHaveBeenCalledWith({
      where: { id: 'charge', companyId: 'company' },
    });
    expect(charges.recordSettlement).toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'admin',
          companyId: 'company',
        }) as unknown,
      }),
    );
  });
  it('leaves an active charge for manual review without reissuing', async () => {
    const { service, charges } = fixture('ATIVA');
    await expect(
      service.reconcileCharge('company', 'charge', 'admin'),
    ).resolves.toEqual({ status: 'REVIEW_REQUIRED' });
    expect(charges.recordSettlement).not.toHaveBeenCalled();
    expect(charges.transition).not.toHaveBeenCalled();
  });
  it('does not infer a canceled or absent charge from a failed provider GET', async () => {
    const { service, sdk, charges } = fixture();
    sdk.pixDetailDueCharge.mockRejectedValue(
      new Error('secret provider details'),
    );
    await expect(
      service.reconcileCharge('company', 'charge', 'admin'),
    ).rejects.toMatchObject({
      status: 502,
      message: 'Falha ao processar cobranca na Efi.',
    });
    expect(charges.transition).not.toHaveBeenCalled();
  });
  it('requires Efí assistance when a one-step timeout lost its provider identifier', async () => {
    const { service, sdk } = fixture('ATIVA', null);
    await expect(
      service.reconcileCharge('company', 'charge', 'admin'),
    ).resolves.toEqual({ status: 'REVIEW_REQUIRED' });
    expect(sdk.pixDetailDueCharge).not.toHaveBeenCalled();
    expect(sdk.detailCharge).not.toHaveBeenCalled();
  });
  it('does not accept provider detail belonging to another identifier', async () => {
    const { service, sdk, charges } = fixture();
    sdk.pixDetailDueCharge.mockResolvedValue({
      txid: 'other-txid',
      status: 'CONCLUIDA',
    });
    await expect(
      service.reconcileCharge('company', 'charge', 'admin'),
    ).rejects.toMatchObject({ status: 502 });
    expect(charges.recordSettlement).not.toHaveBeenCalled();
  });
  it('preserves confirmed boleto expiration for manual replacement', async () => {
    const { service, sdk, charges, prisma } = fixture();
    prisma.paymentCharge.findFirst.mockResolvedValue({
      id: 'charge',
      invoiceId: 'invoice',
      companyId: 'company',
      efiTxid: null,
      efiChargeId: '42',
    });
    sdk.detailCharge.mockResolvedValue({
      data: { charge_id: 42, status: 'expired' },
    });
    await expect(
      service.reconcileCharge('company', 'charge', 'admin'),
    ).resolves.toEqual({ status: 'EXPIRED' });
    expect(charges.transition).toHaveBeenCalledWith(
      'charge',
      'company',
      'EXPIRED',
      expect.anything(),
      'expired',
    );
  });
});
