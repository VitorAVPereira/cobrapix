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
  messageTemplate: {
    findMany: jest.Mock<Promise<TemplateRecord[]>, [FindManyTemplatesArgs]>;
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
  }): Promise<TemplateRecord | null>;
}

interface SendMessageJobProcessor {
  processSendMessageJob(data: SendMessageJob): Promise<void>;
}

function createPrismaMock(templates: TemplateRecord[]): PrismaMock {
  return {
    messageTemplate: {
      findMany: jest.fn(async (args: FindManyTemplatesArgs) =>
        templates.filter(
          (template) =>
            args.where.slug.in.includes(template.slug) &&
            template.metaStatus === args.where.metaStatus,
        ),
      ),
    },
    invoice: {
      findFirst: jest.fn(async () => ({ status: 'PENDING' })),
    },
    collectionLog: {
      create: jest.fn(async () => ({})),
    },
    debtor: {
      findFirst: jest.fn(async () => ({ whatsappOptIn: true })),
    },
  };
}

function createWorker(prisma: PrismaMock): TemplateSelector & SendMessageJobProcessor {
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
    });

    expect(template?.slug).toBe('cobranca-emissao');
    expect(prisma.messageTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          slug: { in: ['vencimento-hoje', 'cobranca-emissao'] },
          metaStatus: 'APPROVED',
        }),
      }),
    );
  });

  it('ignora envio WhatsApp quando a fatura nao esta mais pendente', async () => {
    const prisma = createPrismaMock([]);
    prisma.invoice.findFirst.mockResolvedValueOnce({ status: 'CANCELED' });
    const whatsappService = {
      sendTemplateMessage: jest.fn(async () => ({
        messageId: 'meta-message-1',
        status: 'sent',
      })),
    };
    const messagingLimitService = {
      canSend: jest.fn(async () => ({
        allowed: true,
        usage: 0,
        limit: 100,
        resetAt: Date.now() + 60_000,
      })),
      trackSend: jest.fn(async () => undefined),
      recordInteraction: jest.fn(async () => undefined),
    };
    const rateLimitService = {
      checkRateLimit: jest.fn(async () => ({
        allowed: true,
        resetAt: Date.now() + 60_000,
      })),
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
    expect(prisma.collectionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'company-1',
        invoiceId: 'invoice-1',
        actionType: 'MESSAGE_SKIPPED_INVOICE_NOT_PENDING',
        status: 'SKIPPED',
      }),
    });
    expect(prisma.collectionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        description: expect.stringContaining('WHATSAPP'),
      }),
    });
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
