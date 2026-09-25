import type { ConfigService } from '@nestjs/config';
import type { EmailQueueService } from '../../email/email.queue';
import type { EmailTemplatesService } from '../../email/email-templates.service';
import type { EmailService } from '../../email/email.service';
import type { PublicPaymentLinkService } from '../../payment/payment-link.service';
import type { PaymentService } from '../../payment/payment.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { WhatsappService } from '../../whatsapp/whatsapp.service';
import type { InitialChargeJob, MessageQueueService } from '../message.queue';
import type { MessagingLimitService } from '../services/messaging-limit.service';
import type { RateLimitService } from '../services/rate-limit.service';
import type { SpintaxService } from '../services/spintax.service';
import { MessageWorkerService } from './message.worker';

interface InitialChargeProcessor {
  processInitialChargeJob(data: InitialChargeJob): Promise<void>;
}

function fixture(financiallyActive: boolean): {
  process: InitialChargeProcessor;
  invoiceFindFirst: jest.Mock;
  logCreate: jest.Mock;
} {
  const invoiceFindFirst = jest.fn().mockResolvedValue(null);
  const logCreate = jest.fn().mockResolvedValue({});
  const prisma = {
    invoice: { findFirst: invoiceFindFirst },
    collectionLog: { create: logCreate },
  } as unknown as PrismaService;
  const worker = new MessageWorkerService(
    {} as ConfigService,
    prisma,
    {} as RateLimitService,
    {} as MessagingLimitService,
    {
      hasActiveFinancialProfile: jest.fn().mockResolvedValue(financiallyActive),
    } as unknown as PaymentService,
    {} as SpintaxService,
    {} as MessageQueueService,
    {} as WhatsappService,
    {} as EmailQueueService,
    {} as EmailService,
    {} as EmailTemplatesService,
    {} as PublicPaymentLinkService,
  );
  return {
    process: worker as unknown as InitialChargeProcessor,
    invoiceFindFirst,
    logCreate,
  };
}

describe('initial payment issuance fencing', () => {
  const job: InitialChargeJob = {
    invoiceId: 'invoice-1',
    companyId: 'company-1',
    source: 'MANUAL',
  };

  it('consumes a queued draft without issuing it and records why', async () => {
    const { process, invoiceFindFirst, logCreate } = fixture(false);
    await process.processInitialChargeJob(job);
    expect(invoiceFindFirst).not.toHaveBeenCalled();
    expect(logCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'company-1',
          invoiceId: 'invoice-1',
          actionType: 'INITIAL_CHARGE_SKIPPED',
        }) as unknown,
      }),
    );
  });

  it('loads active-era initial jobs from draft or pending invoices', async () => {
    const { process, invoiceFindFirst } = fixture(true);
    await process.processInitialChargeJob(job);
    expect(invoiceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['DRAFT', 'PENDING'] },
        }) as unknown,
      }),
    );
  });
});
