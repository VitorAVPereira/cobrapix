import { HttpException, HttpStatus } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { EfiService } from './efi.service';
import { PrismaService } from '../prisma/prisma.service';

describe('PaymentService billing method restrictions', () => {
  it('bloqueia emissao quando o metodo nao esta habilitado para a empresa', async () => {
    const prisma = {
      invoice: {
        findFirst: jest.fn().mockResolvedValue({ status: 'PENDING' }),
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
    const service = new PaymentService(efiService, prisma);

    await expect(
      service.createPayment('invoice-1', 'company-1', 'BOLETO'),
    ).rejects.toThrow(HttpException);
    expect(prisma.invoice.findFirst).toHaveBeenCalledWith({
      where: { id: 'invoice-1', companyId: 'company-1' },
      select: { status: true },
    });
    expect(createPayment).not.toHaveBeenCalled();
  });

  it('permite emissao quando o metodo esta habilitado para a empresa', async () => {
    const prisma = {
      invoice: {
        findFirst: jest.fn().mockResolvedValue({ status: 'PENDING' }),
      },
      company: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'company-1',
          enabledBillingMethods: ['PIX', 'BOLETO'],
        }),
      },
    } as unknown as PrismaService;
    const efiService = {
      createPayment: jest.fn().mockResolvedValue({ gatewayId: 'gateway-1' }),
    } as unknown as EfiService;
    const service = new PaymentService(efiService, prisma);

    await expect(
      service.createPayment('invoice-1', 'company-1', 'BOLETO'),
    ).resolves.toEqual({ gatewayId: 'gateway-1' });
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
    const service = new PaymentService(efiService, prisma);

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
    const service = new PaymentService(efiService, prisma);

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
    const service = new PaymentService(efiService, prisma);

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
    const service = new PaymentService(efiService, prisma);

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
    const service = new PaymentService(efiService, prisma);

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
