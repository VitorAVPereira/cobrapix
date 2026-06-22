import type { ConfigService } from '@nestjs/config';
import type { EmailQueueService } from '../../email/email.queue';
import type { EmailTemplatesService } from '../../email/email-templates.service';
import type { EmailService } from '../../email/email.service';
import type { PublicPaymentLinkService } from '../../payment/payment-link.service';
import type { PaymentService } from '../../payment/payment.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { WhatsappService } from '../../whatsapp/whatsapp.service';
import type { MessageQueueService } from '../message.queue';
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

interface PrismaMock {
  messageTemplate: {
    findMany: jest.Mock<Promise<TemplateRecord[]>, [FindManyTemplatesArgs]>;
  };
}

interface TemplateSelector {
  findMessageTemplate(invoice: {
    companyId: string;
    dueDate: Date;
  }): Promise<TemplateRecord | null>;
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
  };
}

function createWorker(prisma: PrismaMock): TemplateSelector {
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

  return service as unknown as TemplateSelector;
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
});
