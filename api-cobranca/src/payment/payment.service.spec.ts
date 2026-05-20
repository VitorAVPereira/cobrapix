import { HttpException } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { EfiService } from './efi.service';
import { PrismaService } from '../prisma/prisma.service';

describe('PaymentService billing method restrictions', () => {
  it('bloqueia emissao quando o metodo nao esta habilitado para a empresa', async () => {
    const prisma = {
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
    expect(createPayment).not.toHaveBeenCalled();
  });

  it('permite emissao quando o metodo esta habilitado para a empresa', async () => {
    const prisma = {
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
});
