import { ConfigService } from '@nestjs/config';
import { PublicPaymentLinkService } from './payment-link.service';
import { PrismaService } from '../prisma/prisma.service';

const TEST_SECRET = 'payment-secret-with-more-than-thirty-two-characters';

function createService() {
  const prisma = {
    invoice: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'invoice-1',
        companyId: 'company-1',
        originalAmount: { toNumber: () => 150.5 },
        dueDate: new Date('2026-05-30T12:00:00.000Z'),
        billingType: 'BOLIX',
        efiPixCopiaECola: 'pix-copia-e-cola',
        pixPayload: null,
        pixExpiresAt: null,
        boletoLinhaDigitavel: '00190000000',
        boletoLink: 'https://boleto.example/1',
        boletoPdf: 'https://boleto.example/1.pdf',
        debtor: { name: 'Maria Silva' },
        company: { corporateName: 'Empresa Teste' },
      }),
    },
  } as unknown as PrismaService;
  const config = {
    get: jest.fn((key: string, fallback?: string) => {
      if (key === 'PAYMENT_SECRET_KEY') return TEST_SECRET;
      if (key === 'FRONTEND_URL') return 'https://app.cobrapix.test';
      return fallback;
    }),
  } as unknown as ConfigService;

  return {
    service: new PublicPaymentLinkService(config, prisma),
    prisma: prisma as unknown as {
      invoice: { findFirst: jest.Mock };
    },
  };
}

describe('PublicPaymentLinkService', () => {
  it('gera token assinado e resolve dados minimos da cobranca', async () => {
    const { service, prisma } = createService();
    const paymentPage = service.createInvoicePaymentPage({
      companyId: 'company-1',
      invoiceId: 'invoice-1',
    });

    expect(paymentPage.url).toBe(
      `https://app.cobrapix.test/pagar/${paymentPage.token}`,
    );

    const result = await service.getPublicPayment(paymentPage.token);

    expect(prisma.invoice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'invoice-1', companyId: 'company-1', status: 'PENDING' },
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        invoiceId: 'invoice-1',
        companyName: 'Empresa Teste',
        debtorName: 'Maria Silva',
        pixCopyPaste: 'pix-copia-e-cola',
        boletoLine: '00190000000',
      }),
    );
  });

  it('rejeita token invalido antes de consultar o banco', async () => {
    const { service, prisma } = createService();

    await expect(service.getPublicPayment('token-invalido')).rejects.toThrow(
      'Link de pagamento invalido ou expirado.',
    );

    expect(prisma.invoice.findFirst).not.toHaveBeenCalled();
  });
});
