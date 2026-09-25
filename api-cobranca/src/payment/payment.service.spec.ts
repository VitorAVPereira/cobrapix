import { HttpException, HttpStatus } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { EfiService } from './efi.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentChargeService } from './payment-charge.service';

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

  function issuanceFixture(issuerIdentityId: string | null) {
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
    const efiCreatePayment = jest
      .fn()
      .mockResolvedValue({ gatewayId: 'gateway-1' });
    const efiService = {
      assertIssuable: jest.fn().mockResolvedValue(financial),
      createPayment: efiCreatePayment,
    } as unknown as EfiService;
    const createDraft = jest.fn().mockResolvedValue({
      id: 'charge-1',
      grossAmountCents: 10000,
      issuerIdentityId,
      feeSnapshot: { platformFee: { kind: 'PERCENTAGE', basisPoints: 250 } },
    });
    const charges = {
      findReusable: jest.fn().mockResolvedValue(null),
      createDraft,
      transition: jest.fn().mockResolvedValue(undefined),
      markIssued: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    } as unknown as PaymentChargeService;
    return {
      financial,
      createDraft,
      efiCreatePayment,
      service: new PaymentService(efiService, prisma, charges),
    };
  }

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
