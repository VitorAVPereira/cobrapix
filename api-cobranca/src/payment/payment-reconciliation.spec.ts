import { ConfigService } from '@nestjs/config';
import { EfiService, ReconcileChargeResult } from './efi.service';
import { PaymentChargeService } from './payment-charge.service';
import { PaymentCryptoService } from './payment-crypto.service';
import { PaymentNotificationsService } from './payment-notifications.service';
import { PrismaService } from '../prisma/prisma.service';

interface Reconciler {
  reconcileCharge(
    companyId: string,
    chargeId: string,
    actorId: string,
  ): Promise<ReconcileChargeResult>;
}

const HOUR = 3_600_000;

describe('Uncertain payment reconciliation', () => {
  function fixture(
    status = 'CONCLUIDA',
    txid: string | null = 'known-txid',
    overrides: Record<string, unknown> = {},
  ) {
    const charge = {
      id: 'charge',
      invoiceId: 'invoice',
      companyId: 'company',
      billingMethod: txid ? 'PIX' : 'BOLIX',
      status: 'PENDING',
      grossAmountCents: 500,
      paymentDaysAfterDue: 0,
      createdAt: new Date(Date.now() - 2 * HOUR),
      efiTxid: txid,
      efiChargeId: null as string | null,
      gatewayId: null as string | null,
      issuerIdentityId: null,
      ...overrides,
    };
    const prisma = {
      paymentCharge: {
        findFirst: jest.fn().mockResolvedValue(charge),
      },
      invoice: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ dueDate: new Date('2026-10-10T03:00:00Z') }),
      },
      gatewayAccount: {
        findFirst: jest.fn().mockResolvedValue({ companyId: 'company' }),
      },
      auditLog: { create: jest.fn() },
    };
    const charges = {
      recordSettlement: jest.fn().mockResolvedValue(false),
      transition: jest.fn(),
      recordReconciliation: jest.fn().mockResolvedValue('PENDING'),
      attachProviderReference: jest.fn(),
      confirmIssuance: jest.fn().mockResolvedValue('ACTIVE'),
    };
    const sdk = {
      pixDetailDueCharge: jest
        .fn()
        .mockResolvedValue({ txid: 'known-txid', status }),
      detailCharge: jest.fn(),
      listCharges: jest.fn().mockResolvedValue({ code: 200, data: [] }),
      createOneStepCharge: jest.fn(),
      pixCreateDueCharge: jest.fn(),
    };
    const service = new EfiService(
      {} as ConfigService,
      prisma as unknown as PrismaService,
      {} as PaymentCryptoService,
      {} as PaymentNotificationsService,
      null,
      charges as unknown as PaymentChargeService,
    );
    const createSdkClient = jest
      .spyOn(
        service as unknown as { createSdkClient(): typeof sdk },
        'createSdkClient',
      )
      .mockReturnValue(sdk);
    return {
      service: service as unknown as Reconciler,
      prisma,
      sdk,
      charges,
      charge,
      createSdkClient,
    };
  }

  // Bolix detail as returned by GET /v1/charge/:id (not the creation shape).
  const bolixDetail = (data: Record<string, unknown> = {}) => ({
    code: 200,
    data: {
      charge_id: 555,
      custom_id: 'charge',
      total: 500,
      status: 'waiting',
      payment: {
        method: 'banking_billet',
        banking_billet: {
          barcode: '0019',
          link: 'https://boleto.example.test',
          pdf: { charge: 'https://boleto.example.test/pdf' },
          expire_at: '2026-10-10',
          pix: { qrcode: '000201bolix', qrcode_image: 'data:image/png' },
        },
      },
      ...data,
    },
  });

  it('uses only the persisted identifier and provider GET to reflect paid state', async () => {
    const { service, sdk, charges, prisma } = fixture();
    await expect(
      service.reconcileCharge('company', 'charge', 'admin'),
    ).resolves.toMatchObject({ status: 'PAID' });
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

  it('leaves an open Pix for review: its split link cannot be proven by the detail', async () => {
    const { service, charges } = fixture('ATIVA');
    await expect(
      service.reconcileCharge('company', 'charge', 'admin'),
    ).resolves.toEqual({
      status: 'REVIEW_REQUIRED',
      reasonCode: 'PIX_SPLIT_LINK_UNVERIFIED',
      recommendedAction: 'CHECK_EFI_PANEL',
    });
    expect(charges.recordSettlement).not.toHaveBeenCalled();
    expect(charges.transition).not.toHaveBeenCalled();
    expect(charges.confirmIssuance).not.toHaveBeenCalled();
    expect(charges.recordReconciliation).toHaveBeenCalledWith(
      'charge',
      'company',
      { reasonCode: 'PIX_SPLIT_LINK_UNVERIFIED', providerStatus: 'ATIVA' },
    );
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
    expect(charges.recordReconciliation).not.toHaveBeenCalled();
  });

  it('releases an old open Pix reservation Efí explicitly does not know', async () => {
    const { service, sdk, charges } = fixture();
    charges.recordReconciliation.mockResolvedValue('FAILED');
    sdk.pixDetailDueCharge.mockRejectedValue({
      nome: 'cobranca_nao_encontrada',
      mensagem: 'Nenhuma cobrança encontrada para o txid informado',
    });
    await expect(
      service.reconcileCharge('company', 'charge', 'admin'),
    ).resolves.toEqual({
      status: 'FAILED',
      reasonCode: 'PROVIDER_NOT_FOUND',
      recommendedAction: 'REISSUE',
    });
    expect(charges.recordReconciliation).toHaveBeenCalledWith(
      'charge',
      'company',
      { reasonCode: 'PROVIDER_NOT_FOUND', fail: true },
    );
    expect(sdk.pixCreateDueCharge).not.toHaveBeenCalled();
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
    const { service, sdk, charges } = fixture('x', null, {
      efiChargeId: '42',
      status: 'ACTIVE',
    });
    sdk.detailCharge.mockResolvedValue({
      data: { charge_id: 42, status: 'expired' },
    });
    await expect(
      service.reconcileCharge('company', 'charge', 'admin'),
    ).resolves.toMatchObject({ status: 'EXPIRED' });
    expect(charges.transition).toHaveBeenCalledWith(
      'charge',
      'company',
      'EXPIRED',
      expect.anything(),
      'expired',
    );
  });

  describe('Bolix whose creation response was lost', () => {
    it('finds it by custom_id on the issuing account and recovers the payable charge', async () => {
      const { service, sdk, charges, createSdkClient } = fixture('x', null, {
        createdAt: new Date('2026-09-29T18:12:27.000Z'),
      });
      sdk.listCharges.mockResolvedValue({
        code: 200,
        data: [{ id: 555, custom_id: 'charge', total: 500, status: 'waiting' }],
      });
      sdk.detailCharge.mockResolvedValue(bolixDetail());
      await expect(
        service.reconcileCharge('company', 'charge', 'admin'),
      ).resolves.toEqual({
        status: 'ACTIVE',
        reasonCode: 'ISSUANCE_RECOVERED',
        recommendedAction: 'NONE',
      });
      expect(createSdkClient).toHaveBeenCalledTimes(1);
      expect(sdk.listCharges).toHaveBeenCalledWith(
        expect.objectContaining({
          charge_type: 'billet',
          custom_id: 'charge',
          begin_date: '2026-09-28',
        }),
      );
      expect(charges.attachProviderReference).toHaveBeenCalledWith(
        'charge',
        'company',
        '555',
      );
      expect(sdk.detailCharge).toHaveBeenCalledWith({ id: '555' });
      expect(charges.confirmIssuance).toHaveBeenCalledWith(
        'company',
        'charge',
        expect.objectContaining({
          source: 'RECONCILIATION',
          billingMethod: 'BOLIX',
          providerChargeId: '555',
          boletoCode: '0019',
          boletoLink: 'https://boleto.example.test',
          pixCopyPaste: '000201bolix',
        }),
      );
      expect(sdk.createOneStepCharge).not.toHaveBeenCalled();
    });

    it('releases an old reservation Efí does not have, so it can be issued again', async () => {
      const { service, sdk, charges } = fixture('x', null);
      charges.recordReconciliation.mockResolvedValue('FAILED');
      await expect(
        service.reconcileCharge('company', 'charge', 'admin'),
      ).resolves.toEqual({
        status: 'FAILED',
        reasonCode: 'PROVIDER_NOT_FOUND',
        recommendedAction: 'REISSUE',
      });
      expect(charges.recordReconciliation).toHaveBeenCalledWith(
        'charge',
        'company',
        { reasonCode: 'PROVIDER_NOT_FOUND', fail: true },
      );
      expect(sdk.createOneStepCharge).not.toHaveBeenCalled();
    });

    it('waits before declaring a recent reservation absent', async () => {
      const { service, charges } = fixture('x', null, {
        createdAt: new Date(Date.now() - 60_000),
      });
      await expect(
        service.reconcileCharge('company', 'charge', 'admin'),
      ).resolves.toMatchObject({
        status: 'REVIEW_REQUIRED',
        reasonCode: 'ISSUANCE_TOO_RECENT',
      });
      expect(charges.recordReconciliation).toHaveBeenCalledWith(
        'charge',
        'company',
        { reasonCode: 'ISSUANCE_TOO_RECENT', providerStatus: null },
      );
    });

    it('does not infer absence from a failed listing', async () => {
      const { service, sdk, charges } = fixture('x', null);
      sdk.listCharges.mockRejectedValue({ code: 500, error: 'server_error' });
      await expect(
        service.reconcileCharge('company', 'charge', 'admin'),
      ).rejects.toMatchObject({ status: 502 });
      sdk.listCharges.mockResolvedValue({ message: 'unexpected' });
      await expect(
        service.reconcileCharge('company', 'charge', 'admin'),
      ).rejects.toMatchObject({ status: 502 });
      expect(charges.recordReconciliation).not.toHaveBeenCalled();
    });

    it.each([
      [
        'another amount',
        [{ id: 555, custom_id: 'charge', total: 300 }],
        'PROVIDER_AMOUNT_MISMATCH',
      ],
      [
        'two charges with the same custom_id',
        [
          { id: 555, custom_id: 'charge', total: 500 },
          { id: 556, custom_id: 'charge', total: 500 },
        ],
        'PROVIDER_DUPLICATE_ISSUANCE',
      ],
    ])(
      'keeps %s for review without linking it',
      async (_name, data, reasonCode) => {
        const { service, sdk, charges } = fixture('x', null);
        sdk.listCharges.mockResolvedValue({ code: 200, data });
        await expect(
          service.reconcileCharge('company', 'charge', 'admin'),
        ).resolves.toMatchObject({ status: 'REVIEW_REQUIRED', reasonCode });
        expect(charges.attachProviderReference).not.toHaveBeenCalled();
      },
    );

    it('links nothing when the located charge detail names another attempt', async () => {
      const { service, sdk, charges } = fixture('x', null);
      sdk.listCharges.mockResolvedValue({
        code: 200,
        data: [{ id: 555, custom_id: 'charge', total: 500 }],
      });
      sdk.detailCharge.mockResolvedValue(
        bolixDetail({ custom_id: 'another-charge' }),
      );
      await expect(
        service.reconcileCharge('company', 'charge', 'admin'),
      ).resolves.toMatchObject({
        status: 'REVIEW_REQUIRED',
        reasonCode: 'PROVIDER_REFERENCE_MISMATCH',
      });
      expect(charges.attachProviderReference).not.toHaveBeenCalled();
      expect(charges.confirmIssuance).not.toHaveBeenCalled();
    });

    it('ignores listing entries of other custom ids', async () => {
      const { service, sdk, charges } = fixture('x', null);
      charges.recordReconciliation.mockResolvedValue('FAILED');
      sdk.listCharges.mockResolvedValue({
        code: 200,
        data: [{ id: 9, custom_id: 'another', total: 500 }],
      });
      await expect(
        service.reconcileCharge('company', 'charge', 'admin'),
      ).resolves.toMatchObject({ reasonCode: 'PROVIDER_NOT_FOUND' });
      expect(charges.attachProviderReference).not.toHaveBeenCalled();
    });
  });

  describe('Bolix with a known reference', () => {
    const known = { efiChargeId: '555', gatewayId: '555' };

    it('never distributes a boleto without Pix when Bolix was requested', async () => {
      const { service, sdk, charges } = fixture('x', null, known);
      const detail = bolixDetail();
      delete (detail.data.payment.banking_billet as { pix?: unknown }).pix;
      sdk.detailCharge.mockResolvedValue(detail);
      await expect(
        service.reconcileCharge('company', 'charge', 'admin'),
      ).resolves.toEqual({
        status: 'REVIEW_REQUIRED',
        reasonCode: 'MODALITY_MISMATCH',
        recommendedAction: 'REVIEW_ACCOUNT_MODALITY',
      });
      expect(charges.recordReconciliation).toHaveBeenCalledWith(
        'charge',
        'company',
        expect.objectContaining({
          gatewayStatusRaw: 'EFI_BILLING_MODE_MISMATCH',
        }),
      );
      expect(charges.confirmIssuance).not.toHaveBeenCalled();
    });

    it.each([
      [
        'another custom_id',
        { custom_id: 'other' },
        'PROVIDER_REFERENCE_MISMATCH',
      ],
      ['another amount', { total: 300 }, 'PROVIDER_AMOUNT_MISMATCH'],
      [
        'no instruments',
        {
          payment: {
            method: 'banking_billet',
            banking_billet: { pix: { qrcode: 'x' } },
          },
        },
        'INSTRUMENTS_MISSING',
      ],
    ])('keeps %s for review', async (_name, data, reasonCode) => {
      const { service, sdk, charges } = fixture('x', null, known);
      sdk.detailCharge.mockResolvedValue(bolixDetail(data));
      await expect(
        service.reconcileCharge('company', 'charge', 'admin'),
      ).resolves.toMatchObject({ status: 'REVIEW_REQUIRED', reasonCode });
      expect(charges.confirmIssuance).not.toHaveBeenCalled();
    });

    it('reports a payment a webhook applied during the consultation', async () => {
      const { service, sdk, charges, prisma } = fixture('x', null, known);
      sdk.detailCharge.mockResolvedValue(bolixDetail());
      charges.confirmIssuance.mockResolvedValue('ALREADY_FINALIZED');
      prisma.paymentCharge.findFirst
        .mockResolvedValueOnce({
          ...(await prisma.paymentCharge.findFirst()),
          ...known,
        })
        .mockResolvedValueOnce({ status: 'PAID' });
      await expect(
        service.reconcileCharge('company', 'charge', 'admin'),
      ).resolves.toEqual({
        status: 'PAID',
        reasonCode: 'ALREADY_FINALIZED',
        recommendedAction: 'NONE',
      });
    });

    it('settles through the idempotent routine when Efí reports it paid', async () => {
      const { service, sdk, charges } = fixture('x', null, known);
      sdk.detailCharge.mockResolvedValue(bolixDetail({ status: 'paid' }));
      await expect(
        service.reconcileCharge('company', 'charge', 'admin'),
      ).resolves.toMatchObject({ status: 'PAID' });
      expect(charges.recordSettlement).toHaveBeenCalled();
      expect(charges.confirmIssuance).not.toHaveBeenCalled();
    });

    it('does not reopen a closed charge that Efí still shows as payable', async () => {
      const { service, sdk, charges } = fixture('x', null, {
        ...known,
        status: 'CANCELED',
      });
      sdk.detailCharge.mockResolvedValue(bolixDetail());
      await expect(
        service.reconcileCharge('company', 'charge', 'admin'),
      ).resolves.toMatchObject({ reasonCode: 'PROVIDER_STATE_DIVERGENT' });
      expect(charges.confirmIssuance).not.toHaveBeenCalled();
    });

    it('keeps an unknown provider status for review', async () => {
      const { service, sdk } = fixture('x', null, known);
      sdk.detailCharge.mockResolvedValue(bolixDetail({ status: 'contested' }));
      await expect(
        service.reconcileCharge('company', 'charge', 'admin'),
      ).resolves.toMatchObject({
        status: 'REVIEW_REQUIRED',
        reasonCode: 'PROVIDER_STATUS_UNKNOWN',
      });
    });
  });
});
