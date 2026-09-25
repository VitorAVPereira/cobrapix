import { ConflictException } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { ConfigService } from '@nestjs/config';
import type { EmailQueueService } from '../../email/email.queue';
import type { EmailTemplatesService } from '../../email/email-templates.service';
import type { EmailService } from '../../email/email.service';
import type { PublicPaymentLinkService } from '../../payment/payment-link.service';
import type { PaymentService } from '../../payment/payment.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { WhatsappService } from '../../whatsapp/whatsapp.service';
import { WhatsappTransportError } from '../../whatsapp/transport/whatsapp-transport.error';
import type { MessageQueueService, WhatsAppQueueJob } from '../message.queue';
import type { MessagingLimitService } from '../services/messaging-limit.service';
import type { RateLimitService } from '../services/rate-limit.service';
import type { SpintaxService } from '../services/spintax.service';
import { MessageWorkerService } from './message.worker';

function setup(error: unknown) {
  const prisma = {
    collectionLog: {
      create: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
    collectionAttempt: {
      upsert: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
  };
  const whatsapp = {
    dispatchIntent: jest.fn().mockRejectedValue(error),
    rejectedCollection: jest.fn().mockResolvedValue({
      companyId: 'company-a',
      invoiceId: 'invoice-a',
      ruleStepId: 'step-1',
    }),
  };
  const worker = new MessageWorkerService(
    {} as ConfigService,
    prisma as unknown as PrismaService,
    {} as RateLimitService,
    {} as MessagingLimitService,
    {} as PaymentService,
    {} as SpintaxService,
    {} as MessageQueueService,
    whatsapp as unknown as WhatsappService,
    {} as EmailQueueService,
    {} as EmailService,
    {} as EmailTemplatesService,
    {} as PublicPaymentLinkService,
  );
  const job = {
    name: 'outbound-intent',
    data: { intentId: 'intent-1' },
  } as Job<WhatsAppQueueJob>;
  const run = (): Promise<void> =>
    (
      worker as unknown as {
        processJob(job: Job<WhatsAppQueueJob>): Promise<void>;
      }
    ).processJob(job);
  return { prisma, whatsapp, run };
}

describe('MessageWorkerService recovered outbound intents', () => {
  it('records the collection failure when a recovered intent is rejected', async () => {
    const { prisma, run } = setup(new Error('COLLECTION_NO_LONGER_ELIGIBLE'));
    await expect(run()).rejects.toThrow('COLLECTION_NO_LONGER_ELIGIBLE');
    expect(prisma.collectionLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.collectionLog.create.mock.calls[0]?.[0]).toMatchObject({
      data: {
        companyId: 'company-a',
        invoiceId: 'invoice-a',
        status: 'FAILED',
      },
    });
    expect(prisma.collectionAttempt.upsert.mock.calls[0]?.[0]).toMatchObject({
      where: {
        companyId_invoiceId_ruleStepId_channel: {
          companyId: 'company-a',
          invoiceId: 'invoice-a',
          ruleStepId: 'step-1',
          channel: 'WHATSAPP',
        },
      },
      update: { status: 'FAILED' },
    });
  });

  it.each([
    new WhatsappTransportError('wait', 'RATE_LIMIT', 'NOT_SENT'),
    new WhatsappTransportError('uncertain', 'UNCERTAIN', 'UNCERTAIN'),
    new ConflictException('already processed'),
  ])(
    'keeps pending, uncertain or processed intents out of the failure record',
    async (error) => {
      const { prisma, whatsapp, run } = setup(error);
      await expect(run()).rejects.toBe(error);
      expect(whatsapp.rejectedCollection).not.toHaveBeenCalled();
      expect(prisma.collectionLog.create).not.toHaveBeenCalled();
      expect(prisma.collectionAttempt.upsert).not.toHaveBeenCalled();
    },
  );
});
