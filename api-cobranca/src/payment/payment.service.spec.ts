import { HttpException, HttpStatus } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { EfiService } from './efi.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentChargeService } from './payment-charge.service';
import { toIssuanceError } from './efi-issuance-error';

describe('PaymentService billing method restrictions', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('releases the replacement reservation when the old charge settles during cancellation', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-11T12:00:00.000Z'));
    const replacement = {
      id: 'replacement-1',
      companyId: 'company-1',
      invoiceId: 'invoice-1',
      billingMethod: 'PIX',
      replacesChargeId: 'old-charge-1',
      expiresAt: new Date('2026-09-20T12:00:00.000Z'),
      gatewayStatusRaw: 'REPLACEMENT_CANCEL_PENDING',
    };
    const previous = {
      id: 'old-charge-1',
      companyId: 'company-1',
      invoiceId: 'invoice-1',
      billingMethod: 'PIX',
      efiTxid: 'old-txid',
      efiChargeId: null,
    };
    const prisma = {
      paymentCharge: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(replacement)
          .mockResolvedValueOnce(previous),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      company: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ enabledBillingMethods: ['PIX'] }),
      },
      invoice: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as PrismaService;
    const efiService = {
      assertIssuable: jest.fn().mockResolvedValue(undefined),
      cancelPixDueCharge: jest
        .fn()
        .mockResolvedValue('REMOVIDA_PELO_USUARIO_RECEBEDOR'),
    } as unknown as EfiService;
    const markFailed = jest.fn().mockResolvedValue(undefined);
    const charges = {
      transition: jest.fn().mockResolvedValue(undefined),
      markFailed,
    } as unknown as PaymentChargeService;
    const service = new PaymentService(efiService, prisma, charges);

    await expect(
      service.replaceExpiredCharge(
        'invoice-1',
        'company-1',
        new Date('2026-09-20T12:00:00.000Z'),
      ),
    ).rejects.toThrow('A fatura foi liquidada durante a substituição.');
    expect(markFailed).toHaveBeenCalledWith('replacement-1', 'company-1');
  });

  function issuanceFixture(
    issuerIdentityId: string | null,
    accountMode = 'CUSTOMER_ACCOUNT',
  ) {
    const financial = {
      financialProfileId: 'profile-1',
      issuerIdentityId: 'identity-1',
      issuerCredentialVersionId: 'credential-1',
      accountMode: 'CUSTOMER_ACCOUNT',
      payoutMode: 'DIRECT_TO_CUSTOMER',
      financialEnvironment: 'PRODUCTION',
    };
    const prisma = {
      invoice: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ status: 'PENDING', originalAmount: 100 }),
      },
      company: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'company-1',
          enabledBillingMethods: ['PIX', 'BOLIX'],
        }),
      },
    } as unknown as PrismaService;
    const confirmation = {
      source: 'CREATION',
      billingMethod: 'PIX',
      gatewayId: 'gateway-1',
      paymentLink: '',
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    };
    const efiCreatePayment = jest.fn().mockResolvedValue({
      result: { gatewayId: 'gateway-1' },
      confirmation,
    });
    const efiService = {
      assertIssuable: jest
        .fn()
        .mockResolvedValue({ ...financial, accountMode }),
      createPayment: efiCreatePayment,
    } as unknown as EfiService;
    const createDraft = jest.fn().mockResolvedValue({
      id: 'charge-1',
      grossAmountCents: 10000,
      issuerIdentityId,
      accountMode,
      feeSnapshot: { platformFee: { kind: 'PERCENTAGE', basisPoints: 250 } },
    });
    const confirmIssuance = jest.fn().mockResolvedValue('ACTIVE');
    const recordIssuanceFailure = jest.fn().mockResolvedValue('FAILED');
    const charges = {
      findReusable: jest.fn().mockResolvedValue(null),
      createDraft,
      transition: jest.fn().mockResolvedValue(undefined),
      confirmIssuance,
      recordIssuanceFailure,
    } as unknown as PaymentChargeService;
    return {
      financial,
      confirmation,
      createDraft,
      efiCreatePayment,
      confirmIssuance,
      recordIssuanceFailure,
      service: new PaymentService(efiService, prisma, charges),
    };
  }

  it('confirms the issued charge and returns its instruments', async () => {
    const { service, confirmation, confirmIssuance, recordIssuanceFailure } =
      issuanceFixture('identity-1');
    await expect(
      service.createPayment('invoice-1', 'company-1', 'PIX'),
    ).resolves.toEqual({ gatewayId: 'gateway-1' });
    expect(confirmIssuance).toHaveBeenCalledWith(
      'company-1',
      'charge-1',
      confirmation,
    );
    expect(recordIssuanceFailure).not.toHaveBeenCalled();
  });

  it('releases the reservation when Efí proves it refused the issuance', async () => {
    const {
      service,
      efiCreatePayment,
      recordIssuanceFailure,
      confirmIssuance,
    } = issuanceFixture('identity-1');
    const refusal = toIssuanceError(
      {
        code: 3500034,
        error: 'validation_error',
        error_description: {
          property: '/payment/banking_billet/customer/phone_number',
        },
      },
      'PROVIDER_REQUEST',
    );
    efiCreatePayment.mockRejectedValue(refusal);
    await expect(
      service.createPayment('invoice-1', 'company-1', 'BOLIX'),
    ).rejects.toMatchObject({
      status: 422,
      response: { code: 'EFI_ISSUANCE_REJECTED' },
    });
    expect(recordIssuanceFailure).toHaveBeenCalledWith(
      'charge-1',
      'company-1',
      expect.objectContaining({
        kind: 'REJECTED',
        code: 'EFI_VALIDATION_REJECTED',
      }),
    );
    expect(confirmIssuance).not.toHaveBeenCalled();
  });

  it('keeps an ambiguous submission reserved and never retries it', async () => {
    const { service, efiCreatePayment, recordIssuanceFailure } =
      issuanceFixture('identity-1');
    efiCreatePayment.mockRejectedValue(
      toIssuanceError(new Error('socket hang up'), 'PROVIDER_REQUEST'),
    );
    await expect(
      service.createPayment('invoice-1', 'company-1', 'BOLIX'),
    ).rejects.toMatchObject({
      response: { code: 'EFI_SUBMISSION_UNCERTAIN' },
    });
    expect(efiCreatePayment).toHaveBeenCalledTimes(1);
    expect(recordIssuanceFailure).toHaveBeenCalledWith(
      'charge-1',
      'company-1',
      expect.objectContaining({ kind: 'UNCERTAIN' }),
    );
  });

  it('keeps the issuance uncertain when its local confirmation fails', async () => {
    const { service, confirmIssuance, recordIssuanceFailure } =
      issuanceFixture('identity-1');
    confirmIssuance.mockRejectedValue(new Error('deadlock'));
    await expect(
      service.createPayment('invoice-1', 'company-1', 'PIX'),
    ).rejects.toMatchObject({
      status: 502,
      response: {
        code: 'EFI_SUBMISSION_UNCERTAIN',
        reasonCode: 'LOCAL_PERSISTENCE_FAILED',
      },
    });
    expect(recordIssuanceFailure).toHaveBeenCalledWith(
      'charge-1',
      'company-1',
      expect.objectContaining({
        kind: 'UNCERTAIN',
        stage: 'LOCAL_PERSISTENCE',
      }),
    );
  });

  it('returns the original outcome even if its diagnosis cannot be stored', async () => {
    const { service, efiCreatePayment, recordIssuanceFailure } =
      issuanceFixture('identity-1');
    efiCreatePayment.mockRejectedValue(
      toIssuanceError(new Error('socket hang up'), 'PROVIDER_REQUEST'),
    );
    recordIssuanceFailure.mockRejectedValue(new Error('db down'));
    await expect(
      service.createPayment('invoice-1', 'company-1', 'BOLIX'),
    ).rejects.toMatchObject({
      response: { code: 'EFI_SUBMISSION_UNCERTAIN' },
    });
  });

  it('reserves the charge under the resolved profile and issues on its account', async () => {
    const { service, financial, createDraft, efiCreatePayment } =
      issuanceFixture('identity-1');
    await service.createPayment('invoice-1', 'company-1', 'PIX');
    expect(createDraft).toHaveBeenCalledWith(
      'company-1',
      'invoice-1',
      'PIX',
      10000,
      financial,
    );
    expect(efiCreatePayment).toHaveBeenCalledWith(
      'invoice-1',
      'company-1',
      'PIX',
      expect.objectContaining({
        chargeId: 'charge-1',
        issuerIdentityId: 'identity-1',
        platformFeeBasisPoints: 250,
      }),
    );
  });

  it('never issues a charge without a recorded issuer account', async () => {
    const { service, efiCreatePayment } = issuanceFixture(null);
    await expect(
      service.createPayment('invoice-1', 'company-1', 'PIX'),
    ).rejects.toMatchObject({ response: { code: 'EFI_SUBMISSION_UNCERTAIN' } });
    expect(efiCreatePayment).not.toHaveBeenCalled();
  });

  it('has no issuance path for CifraMais account modes yet', async () => {
    const { service, createDraft, efiCreatePayment } = issuanceFixture(
      'identity-1',
      'PLATFORM_ACCOUNT',
    );
    await expect(
      service.createPayment('invoice-1', 'company-1', 'PIX'),
    ).rejects.toMatchObject({
      response: { code: 'FINANCIAL_MODE_NOT_SUPPORTED' },
    });
    expect(createDraft).not.toHaveBeenCalled();
    expect(efiCreatePayment).not.toHaveBeenCalled();
  });

  it('bloqueia emissao quando o metodo nao esta habilitado para a empresa', async () => {
    const findInvoice = jest.fn().mockResolvedValue({ status: 'PENDING' });
    const prisma = {
      invoice: {
        findFirst: findInvoice,
      },
      company: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'company-1',
          enabledBillingMethods: ['PIX'],
        }),
      },
    } as unknown as PrismaService;
    const createPayment = jest.fn();
    const efiService = {
      createPayment,
    } as unknown as EfiService;
    const service = new PaymentService(efiService, prisma, null);

    await expect(
      service.createPayment('invoice-1', 'company-1', 'BOLETO'),
    ).rejects.toThrow(HttpException);
    expect(findInvoice).toHaveBeenCalledWith({
      where: { id: 'invoice-1', companyId: 'company-1' },
      select: { status: true },
    });
    expect(createPayment).not.toHaveBeenCalled();
  });

  it('bloqueia emissao sem reserva e fotografia da tarifa mesmo com metodo habilitado', async () => {
    const prisma = {
      invoice: {
        findFirst: jest.fn().mockResolvedValue({ status: 'PENDING' }),
      },
      company: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'company-1',
          enabledBillingMethods: ['PIX', 'BOLIX'],
        }),
      },
    } as unknown as PrismaService;
    const efiService = {
      createPayment: jest.fn().mockResolvedValue({ gatewayId: 'gateway-1' }),
    } as unknown as EfiService;
    const service = new PaymentService(efiService, prisma, null);

    await expect(
      service.createPayment('invoice-1', 'company-1', 'BOLIX'),
    ).rejects.toThrow('Serviço de emissão indisponível.');
  });

  it('bloqueia emissao quando a fatura nao existe e nao chama a Efi', async () => {
    const prisma = {
      invoice: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      company: {
        findUnique: jest.fn(),
      },
    } as unknown as PrismaService;
    const createPayment = jest.fn();
    const efiService = {
      createPayment,
    } as unknown as EfiService;
    const service = new PaymentService(efiService, prisma, null);

    let caughtError: unknown;
    try {
      await service.createPayment('invoice-1', 'company-1', 'PIX');
    } catch (error: unknown) {
      caughtError = error;
    }

    if (!(caughtError instanceof HttpException)) {
      throw new Error('Expected createPayment to throw HttpException');
    }
    expect(caughtError.message).toBe('Fatura nao encontrada.');
    expect(caughtError.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(createPayment).not.toHaveBeenCalled();
  });

  it('bloqueia emissao quando a fatura esta cancelada e nao chama a Efi', async () => {
    const prisma = {
      invoice: {
        findFirst: jest.fn().mockResolvedValue({ status: 'CANCELED' }),
      },
      company: {
        findUnique: jest.fn(),
      },
    } as unknown as PrismaService;
    const createPayment = jest.fn();
    const efiService = {
      createPayment,
    } as unknown as EfiService;
    const service = new PaymentService(efiService, prisma, null);

    let caughtError: unknown;
    try {
      await service.createPayment('invoice-1', 'company-1', 'PIX');
    } catch (error: unknown) {
      caughtError = error;
    }

    if (!(caughtError instanceof HttpException)) {
      throw new Error('Expected createPayment to throw HttpException');
    }
    expect(caughtError.message).toBe(
      'Apenas faturas pendentes podem gerar cobranca.',
    );
    expect(caughtError.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(createPayment).not.toHaveBeenCalled();
  });

  it('delega cancelamento para remocao de Pix CobV quando existe txid Efi', async () => {
    const prisma = {} as unknown as PrismaService;
    const cancelPixDueCharge = jest
      .fn()
      .mockResolvedValue('REMOVIDA_PELO_USUARIO_RECEBEDOR');
    const cancelCharge = jest.fn();
    const efiService = {
      cancelPixDueCharge,
      cancelCharge,
    } as unknown as EfiService;
    const service = new PaymentService(efiService, prisma, null);

    await expect(
      service.cancelPaymentForInvoice({
        id: 'invoice-1',
        companyId: 'company-1',
        efiTxid: 'txid-1',
        efiChargeId: 'charge-1',
      }),
    ).resolves.toEqual({
      providerAction: 'PIX_COBV_REMOVED',
      gatewayStatusRaw: 'REMOVIDA_PELO_USUARIO_RECEBEDOR',
    });
    expect(cancelPixDueCharge).toHaveBeenCalledWith('company-1', 'txid-1');
    expect(cancelCharge).not.toHaveBeenCalled();
  });

  it('delega cancelamento para cancelamento de cobranca quando existe charge id Efi', async () => {
    const prisma = {} as unknown as PrismaService;
    const cancelPixDueCharge = jest.fn();
    const cancelCharge = jest.fn().mockResolvedValue('canceled');
    const efiService = {
      cancelPixDueCharge,
      cancelCharge,
    } as unknown as EfiService;
    const service = new PaymentService(efiService, prisma, null);

    await expect(
      service.cancelPaymentForInvoice({
        id: 'invoice-1',
        companyId: 'company-1',
        efiTxid: null,
        efiChargeId: 'charge-1',
      }),
    ).resolves.toEqual({
      providerAction: 'CHARGE_CANCELED',
      gatewayStatusRaw: 'canceled',
    });
    expect(cancelCharge).toHaveBeenCalledWith('company-1', 'charge-1');
    expect(cancelPixDueCharge).not.toHaveBeenCalled();
  });

  it('retorna cancelamento local quando nao existem identificadores Efi', async () => {
    const prisma = {} as unknown as PrismaService;
    const cancelPixDueCharge = jest.fn();
    const cancelCharge = jest.fn();
    const efiService = {
      cancelPixDueCharge,
      cancelCharge,
    } as unknown as EfiService;
    const service = new PaymentService(efiService, prisma, null);

    await expect(
      service.cancelPaymentForInvoice({
        id: 'invoice-1',
        companyId: 'company-1',
        efiTxid: null,
        efiChargeId: null,
      }),
    ).resolves.toEqual({
      providerAction: 'LOCAL_ONLY',
      gatewayStatusRaw: 'CANCELED_BY_USER',
    });
    expect(cancelPixDueCharge).not.toHaveBeenCalled();
    expect(cancelCharge).not.toHaveBeenCalled();
  });
});
