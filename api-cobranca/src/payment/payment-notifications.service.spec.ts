import { PaymentNotificationsService } from './payment-notifications.service';
import { PaymentCryptoService } from './payment-crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { ResendMailerService } from '../common/resend-mailer.service';

function decimal(value: number): { toNumber(): number } {
  return { toNumber: () => value };
}

function buildPaidInvoice(overrides?: {
  paymentNotificationEnabled?: boolean;
  resendApiKeyEncrypted?: string | null;
  resendFromEmail?: string | null;
}) {
  return {
    id: 'invoice-1',
    companyId: 'company-1',
    originalAmount: decimal(150.5),
    dueDate: new Date('2026-05-10T12:00:00.000Z'),
    status: 'PAID',
    paidAt: new Date('2026-05-11T13:00:00.000Z'),
    billingType: 'PIX',
    studentName: 'Joao Silva',
    studentEnrollment: '2026-001',
    studentGroup: '7A',
    debtor: {
      id: 'debtor-1',
      name: 'Responsavel Silva',
      email: 'responsavel@email.com',
    },
    company: {
      corporateName: 'Escola Teste',
      email: 'financeiro@escola.com',
      paymentNotificationEnabled: overrides?.paymentNotificationEnabled ?? true,
      paymentNotificationEmails: ['tesouraria@escola.com'],
      resendApiKeyEncrypted: overrides?.resendApiKeyEncrypted ?? null,
      resendFromEmail: overrides?.resendFromEmail ?? null,
    },
  };
}

describe('PaymentNotificationsService', () => {
  function buildService(prisma: PrismaService): {
    service: PaymentNotificationsService;
    resendMailer: { sendEmail: jest.Mock };
  } {
    const crypto = {
      decrypt: jest.fn().mockReturnValue('resend-key'),
    } as unknown as PaymentCryptoService;
    const resendMailer = {
      sendEmail: jest.fn().mockResolvedValue({ id: 'email-123' }),
    } as unknown as ResendMailerService;

    return {
      service: new PaymentNotificationsService(prisma, crypto, resendMailer),
      resendMailer: resendMailer as unknown as { sendEmail: jest.Mock },
    };
  }

  it('nao duplica notificacao quando ja existe alerta para a fatura', async () => {
    const invoiceFindFirst = jest.fn();
    const prisma = {
      paymentNotification: {
        findFirst: jest.fn().mockResolvedValue({ id: 'notification-1' }),
      },
      invoice: {
        findFirst: invoiceFindFirst,
      },
    } as unknown as PrismaService;

    const { service } = buildService(prisma);
    await service.notifyPaidInvoice('company-1', 'invoice-1');

    expect(invoiceFindFirst).not.toHaveBeenCalled();
  });

  it('registra notificacao pendente sem enviar e-mail quando alerta esta desativado', async () => {
    const updateMany = jest.fn();
    const create = jest.fn().mockResolvedValue({ id: 'notification-1' });
    const prisma = {
      paymentNotification: {
        findFirst: jest.fn().mockResolvedValue(null),
        create,
        updateMany,
      },
      invoice: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            buildPaidInvoice({ paymentNotificationEnabled: false }),
          ),
      },
    } as unknown as PrismaService;

    const { service } = buildService(prisma);
    await service.notifyPaidInvoice('company-1', 'invoice-1');

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'company-1',
          invoiceId: 'invoice-1',
          status: 'PENDING',
        }) as unknown,
      }),
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('mantem notificacao visivel como failed quando envio de e-mail falha', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      paymentNotification: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'notification-1' }),
        updateMany,
      },
      invoice: {
        findFirst: jest.fn().mockResolvedValue(buildPaidInvoice()),
      },
    } as unknown as PrismaService;

    const { service } = buildService(prisma);
    await service.notifyPaidInvoice('company-1', 'invoice-1');

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'notification-1', companyId: 'company-1' },
        data: expect.objectContaining({
          status: 'FAILED',
        }) as unknown,
      }),
    );
  });

  it('envia alerta de pagamento pela conta Resend e remetente da empresa', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      paymentNotification: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'notification-1' }),
        updateMany,
      },
      invoice: {
        findFirst: jest.fn().mockResolvedValue(
          buildPaidInvoice({
            resendApiKeyEncrypted: 'encrypted-resend-key',
            resendFromEmail: 'financeiro@escolateste.com.br',
          }),
        ),
      },
    } as unknown as PrismaService;

    const { service, resendMailer } = buildService(prisma);
    await service.notifyPaidInvoice('company-1', 'invoice-1');

    expect(resendMailer.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'resend-key',
        from: 'Escola Teste <financeiro@escolateste.com.br>',
        to: ['tesouraria@escola.com'],
        subject: '[CobraPix] Pagamento confirmado - Joao Silva',
        html: expect.stringContaining('Responsavel Silva') as string,
      }),
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'notification-1', companyId: 'company-1' },
        data: expect.objectContaining({
          status: 'SENT',
          errorMessage: null,
        }) as unknown,
      }),
    );
  });
});
