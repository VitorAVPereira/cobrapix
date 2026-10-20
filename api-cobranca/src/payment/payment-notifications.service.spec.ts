import { PaymentNotificationsService } from './payment-notifications.service';
import { ConfigService } from '@nestjs/config';
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
    const config = new ConfigService({
      RESEND_API_KEY: 'central-key',
      RESEND_FROM_EMAIL: 'avisos@ciframais.com.br',
      RESEND_REPLY_TO: 'atendimento@ciframais.com.br',
    });
    const resendMailer = {
      sendEmail: jest.fn().mockResolvedValue({ id: 'email-123' }),
    } as unknown as ResendMailerService;

    return {
      service: new PaymentNotificationsService(prisma, config, resendMailer),
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

    const { service, resendMailer } = buildService(prisma);
    resendMailer.sendEmail.mockRejectedValueOnce(
      new Error('Provider unavailable'),
    );
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

  it('envia alerta de pagamento somente pela conta Resend e remetente central', async () => {
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
        apiKey: 'central-key',
        from: 'CifraMais <avisos@ciframais.com.br>',
        to: ['tesouraria@escola.com'],
        subject: '[Cifra+] Pagamento confirmado - Joao Silva',
        html: expect.stringContaining('Responsavel Silva') as string,
      }),
    );
    const html = (resendMailer.sendEmail.mock.calls[0] as [{ html: string }])[0]
      .html;
    expect(html).toContain('Forma de pagamento');
    expect(html).toMatch(/>Pix<\/td>/);
    expect(html).not.toContain('>PIX<');
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
  describe('list and mark as read', () => {
    const now = new Date('2026-10-18T15:00:00.000Z');

    function listPrisma() {
      const findMany = jest.fn().mockResolvedValue([
        {
          id: 'notification-1',
          invoiceId: 'invoice-1',
          status: 'FAILED',
          recipientEmails: ['tesouraria@escola.com'],
          errorMessage: 'Caixa cheia',
          summary: {},
          sentAt: null,
          readAt: null,
          createdAt: now,
          invoice: {
            originalAmount: decimal(150.5),
            dueDate: new Date('2026-10-10T00:00:00.000Z'),
            paidAt: now,
            billingType: 'BOLIX',
            studentName: null,
            studentEnrollment: null,
            studentGroup: null,
            debtor: {
              name: 'Ana Souza',
              email: null,
              document: '52998224725',
            },
          },
        },
      ]);
      const count = jest
        .fn()
        .mockResolvedValueOnce(1234)
        .mockResolvedValueOnce(40)
        .mockResolvedValueOnce(57);
      const updateMany = jest.fn().mockResolvedValue({ count: 3 });
      const prisma = {
        paymentNotification: { findMany, count, updateMany },
      } as unknown as PrismaService;
      return { prisma, findMany, count, updateMany };
    }

    it('pages the company notifications with totals for the filter', async () => {
      const { prisma, findMany, count } = listPrisma();
      const { service } = buildService(prisma);

      const result = await service.list(
        'company-1',
        { page: 3, pageSize: 50 },
        now,
      );

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'company-1' },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: 100,
          take: 50,
        }),
      );
      expect(count).toHaveBeenLastCalledWith({
        where: { companyId: 'company-1', status: { not: 'READ' } },
      });
      expect(result).toEqual(
        expect.objectContaining({
          total: 1234,
          filteredUnread: 40,
          unreadCount: 57,
          page: 3,
          pageSize: 50,
          asOf: now.toISOString(),
        }),
      );
      expect(result.data[0]).toEqual(
        expect.objectContaining({
          debtorName: 'Ana Souza',
          debtorDocument: '52998224725',
          billingType: 'BOLIX',
          errorMessage: 'Caixa cheia',
        }),
      );
    });

    it('filters by state, payment method, São Paulo payment date and document', async () => {
      const { prisma, findMany } = listPrisma();
      const { service } = buildService(prisma);

      await service.list(
        'company-1',
        {
          page: 1,
          pageSize: 20,
          state: 'email_failed',
          billingType: 'BOLETO',
          period: 'today',
          search: '529.982.247-25',
        },
        now,
      );

      const { where } = (findMany.mock.calls as unknown[][])[0][0] as {
        where: Record<string, unknown>;
      };
      expect(where).toEqual({
        companyId: 'company-1',
        errorMessage: { not: null },
        invoice: {
          billingType: { in: ['BOLETO', 'BOLIX'] },
          // 18/10 in São Paulo (UTC-3), from midnight to midnight.
          paidAt: {
            gte: new Date('2026-10-18T03:00:00.000Z'),
            lt: new Date('2026-10-19T03:00:00.000Z'),
          },
          OR: expect.arrayContaining([
            { debtor: { document: { contains: '52998224725' } } },
          ]) as unknown,
        },
      });
    });

    it('searches a name with numbers as a name, not as a document', async () => {
      const { prisma, findMany } = listPrisma();
      const { service } = buildService(prisma);

      await service.list(
        'company-1',
        { page: 1, pageSize: 20, state: 'unread', search: 'Ana 33' },
        now,
      );

      const { where } = (findMany.mock.calls as unknown[][])[0][0] as {
        where: { status: unknown; invoice: { OR: unknown[] } };
      };
      expect(where.status).toEqual({ not: 'READ' });
      expect(where.invoice.OR).toContainEqual({
        debtor: { document: { contains: 'Ana 33' } },
      });
    });

    it('marks only the selected unread rows of the company', async () => {
      const { prisma, updateMany } = listPrisma();
      const { service } = buildService(prisma);

      const result = await service.markManyAsRead('company-1', {
        ids: ['notification-1', 'notification-2'],
      });

      expect(result).toEqual({ count: 3 });
      expect(updateMany).toHaveBeenCalledWith({
        where: {
          AND: [
            {
              companyId: 'company-1',
              id: { in: ['notification-1', 'notification-2'] },
            },
            { status: { not: 'READ' } },
          ],
        },
        data: { status: 'READ', readAt: expect.any(Date) as unknown },
      });
    });

    it('marks every unread row of the filter, but not what arrived after the list', async () => {
      const { prisma, updateMany } = listPrisma();
      const { service } = buildService(prisma);

      await service.markManyAsRead('company-1', {
        filter: { billingType: 'PIX' },
        asOf: now,
      });

      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              {
                AND: [
                  { companyId: 'company-1', invoice: { billingType: 'PIX' } },
                  { createdAt: { lte: now } },
                ],
              },
              { status: { not: 'READ' } },
            ],
          },
        }),
      );
    });
  });
});
