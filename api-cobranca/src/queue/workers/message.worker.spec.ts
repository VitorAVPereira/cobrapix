import type { ConfigService } from '@nestjs/config';
import type { EmailQueueService } from '../../email/email.queue';
import type { EmailTemplatesService } from '../../email/email-templates.service';
import type { EmailService } from '../../email/email.service';
import type { PublicPaymentLinkService } from '../../payment/payment-link.service';
import type { PaymentService } from '../../payment/payment.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { WhatsappService } from '../../whatsapp/whatsapp.service';
import type { MessageQueueService } from '../message.queue';
import type { SendMessageJob } from '../message.queue';
import type { MessagingLimitService } from '../services/messaging-limit.service';
import type { RateLimitService } from '../services/rate-limit.service';
import type { SpintaxService } from '../services/spintax.service';
import { MessageWorkerService } from './message.worker';

interface TemplateRecord {
  slug: string;
  content: string;
  metaTemplateName: string | null;
  metaLanguage: string;
  metaStatus: string;
  paymentButtonEnabled: boolean;
}

interface FindManyTemplatesArgs {
  where: {
    slug: { in: string[] };
    metaStatus: string;
  };
}

interface FindFirstInvoiceStatusArgs {
  where: {
    id: string;
    companyId: string;
  };
  select: {
    status: true;
  };
}

interface InvoiceStatusRecord {
  status: 'PENDING' | 'PAID' | 'CANCELED';
}

interface CollectionLogCreateArgs {
  data: {
    companyId: string;
    invoiceId: string;
    actionType: string;
    description: string;
    status: string;
  };
}

interface FindFirstDebtorOptInArgs {
  where: {
    id: string;
    companyId: string;
  };
  select: {
    whatsappOptIn: true;
  };
}

interface PrismaMock {
  globalMessageTemplate: {
    findMany: jest.Mock<Promise<TemplateRecord[]>, [FindManyTemplatesArgs]>;
  };
  companyTemplatePreference: {
    findMany: jest.Mock<Promise<never[]>, [unknown]>;
  };
  invoice: {
    findFirst: jest.Mock<
      Promise<InvoiceStatusRecord | null>,
      [FindFirstInvoiceStatusArgs]
    >;
  };
  collectionLog: {
    create: jest.Mock<Promise<unknown>, [CollectionLogCreateArgs]>;
  };
  debtor: {
    findFirst: jest.Mock<
      Promise<{ whatsappOptIn: boolean } | null>,
      [FindFirstDebtorOptInArgs]
    >;
  };
}

interface TemplateSelector {
  findMessageTemplate(invoice: {
    companyId: string;
    dueDate: Date;
    company: { corporateName: string; tradeName: string | null };
  }): Promise<TemplateRecord | null>;
}

interface SendMessageJobProcessor {
  processSendMessageJob(data: SendMessageJob): Promise<void>;
}

function createPrismaMock(templates: TemplateRecord[]): PrismaMock {
  return {
    globalMessageTemplate: {
      findMany: jest.fn((args: FindManyTemplatesArgs) =>
        Promise.resolve(
          templates.filter(
            (template) =>
              args.where.slug.in.includes(template.slug) &&
              template.metaStatus === args.where.metaStatus,
          ),
        ),
      ),
    },
    companyTemplatePreference: {
      findMany: jest.fn(() => Promise.resolve([])),
    },
    invoice: {
      findFirst: jest.fn(() => Promise.resolve({ status: 'PENDING' })),
    },
    collectionLog: {
      create: jest.fn(() => Promise.resolve({})),
    },
    debtor: {
      findFirst: jest.fn(() => Promise.resolve({ whatsappOptIn: true })),
    },
  };
}

function createWorker(
  prisma: PrismaMock,
): TemplateSelector & SendMessageJobProcessor {
  const service = new MessageWorkerService(
    {} as ConfigService,
    prisma as unknown as PrismaService,
    {} as RateLimitService,
    {} as MessagingLimitService,
    {} as PaymentService,
    {} as SpintaxService,
    {} as MessageQueueService,
    {} as WhatsappService,
    {} as EmailQueueService,
    {} as EmailService,
    {} as EmailTemplatesService,
    {} as PublicPaymentLinkService,
  );

  return service as unknown as TemplateSelector & SendMessageJobProcessor;
}

describe('MessageWorkerService template selection', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-25T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('usa cobranca-emissao como fallback quando o template da data nao esta aprovado', async () => {
    const templates: TemplateRecord[] = [
      {
        slug: 'vencimento-hoje',
        content: 'Template local de vencimento hoje',
        metaTemplateName: 'cobrapix_vencimento_hoje',
        metaLanguage: 'pt_BR',
        metaStatus: 'LOCAL',
        paymentButtonEnabled: true,
      },
      {
        slug: 'cobranca-emissao',
        content: 'Template aprovado de cobranca na emissao',
        metaTemplateName: 'cobrapix_cobranca_emissao',
        metaLanguage: 'pt_BR',
        metaStatus: 'APPROVED',
        paymentButtonEnabled: true,
      },
    ];
    const prisma = createPrismaMock(templates);
    const worker = createWorker(prisma);

    const template = await worker.findMessageTemplate({
      companyId: 'company-1',
      dueDate: new Date('2026-05-25T12:00:00.000Z'),
      company: { corporateName: 'Empresa Teste', tradeName: 'Loja Teste' },
    });

    expect(template?.slug).toBe('cobranca-emissao');
    expect(
      prisma.globalMessageTemplate.findMany.mock.calls[0]?.[0],
    ).toMatchObject({
      where: {
        slug: { in: ['vencimento-hoje', 'cobranca-emissao'] },
        metaStatus: 'APPROVED',
      },
    });
  });

  it('ignora envio WhatsApp quando a fatura nao esta mais pendente', async () => {
    const prisma = createPrismaMock([]);
    prisma.invoice.findFirst.mockResolvedValueOnce({ status: 'CANCELED' });
    const whatsappService = {
      sendTemplateMessage: jest.fn(() =>
        Promise.resolve({
          messageId: 'meta-message-1',
          status: 'sent',
        }),
      ),
    };
    const messagingLimitService = {
      canSend: jest.fn(() =>
        Promise.resolve({
          allowed: true,
          usage: 0,
          limit: 100,
          resetAt: Date.now() + 60_000,
        }),
      ),
      trackSend: jest.fn(() => Promise.resolve(undefined)),
      recordInteraction: jest.fn(() => Promise.resolve(undefined)),
    };
    const rateLimitService = {
      checkRateLimit: jest.fn(() =>
        Promise.resolve({
          allowed: true,
          resetAt: Date.now() + 60_000,
        }),
      ),
    };
    const service = new MessageWorkerService(
      {} as ConfigService,
      prisma as unknown as PrismaService,
      rateLimitService as unknown as RateLimitService,
      messagingLimitService as unknown as MessagingLimitService,
      {} as PaymentService,
      {} as SpintaxService,
      {} as MessageQueueService,
      whatsappService as unknown as WhatsappService,
      {} as EmailQueueService,
      {} as EmailService,
      {} as EmailTemplatesService,
      {} as PublicPaymentLinkService,
    ) as unknown as SendMessageJobProcessor;

    const job: SendMessageJob = {
      invoiceId: 'invoice-1',
      companyId: 'company-1',
      debtorId: 'debtor-1',
      phoneNumber: '5511999999999',
      senderKey: 'phone-number-id',
      templateName: 'cobrapix_cobranca_emissao',
      templateLanguage: 'pt_BR',
      templateParameters: ['Cliente'],
      debtorName: 'Cliente Teste',
    };

    await service.processSendMessageJob(job);

    expect(whatsappService.sendTemplateMessage).not.toHaveBeenCalled();
    expect(prisma.collectionLog.create.mock.calls[0]?.[0]).toMatchObject({
      data: {
        companyId: 'company-1',
        invoiceId: 'invoice-1',
        actionType: 'MESSAGE_SKIPPED_INVOICE_NOT_PENDING',
        status: 'SKIPPED',
      },
    });
    expect(
      prisma.collectionLog.create.mock.calls[0]?.[0].data.description,
    ).toContain('WHATSAPP');
  });

  it('nao falha o job quando o log de skip da fatura cancelada falha', async () => {
    const prisma = createPrismaMock([]);
    prisma.invoice.findFirst.mockResolvedValueOnce({ status: 'CANCELED' });
    prisma.collectionLog.create.mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    const worker = createWorker(prisma);
    const job: SendMessageJob = {
      invoiceId: 'invoice-1',
      companyId: 'company-1',
      debtorId: 'debtor-1',
      phoneNumber: '5511999999999',
      senderKey: 'phone-number-id',
      templateName: 'cobrapix_cobranca_emissao',
      templateLanguage: 'pt_BR',
      templateParameters: ['Cliente'],
      debtorName: 'Cliente Teste',
    };

    await expect(worker.processSendMessageJob(job)).resolves.toBeUndefined();
  });
});
