import type { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import type { EmailQueueService } from '../../email/email.queue';
import type { EmailTemplatesService } from '../../email/email-templates.service';
import type { EmailService } from '../../email/email.service';
import type { PublicPaymentLinkService } from '../../payment/payment-link.service';
import type { PaymentService } from '../../payment/payment.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { WhatsappService } from '../../whatsapp/whatsapp.service';
import type {
  InitialChargeJob,
  MessageQueueService,
  SendMessageJob,
  WhatsAppQueueJob,
} from '../message.queue';
import type { MessagingLimitService } from '../services/messaging-limit.service';
import type { RateLimitService } from '../services/rate-limit.service';
import type { SpintaxService } from '../services/spintax.service';
import type { TemplateSendPreparerService } from '../../templates/template-send-preparer.service';
import type { TemplatePendingService } from '../../communications/template-pending.service';
import { TemplatePolicyError } from '../../templates/template-contracts';
import { MessageWorkerService } from './message.worker';

interface WorkerInternals {
  processSendMessageJob(data: SendMessageJob): Promise<void>;
  processJob(job: Job<WhatsAppQueueJob>): Promise<void>;
  prepareInitialWhatsapp(
    data: InitialChargeJob,
    invoice: unknown,
  ): Promise<boolean>;
}

const legacyJob: SendMessageJob = {
  invoiceId: 'invoice-1',
  companyId: 'company-1',
  debtorId: 'debtor-1',
  phoneNumber: '5511999999999',
  senderKey: 'phone-number-id',
  templateName: 'cobrapix_cobranca_emissao',
  templateLanguage: 'pt_BR',
  templateParameters: ['Cliente'],
  debtorName: 'Cliente Teste',
  ruleStepId: 'step-1',
};

function setup() {
  const prisma = {
    communicationOutboundIntent: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    collectionLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((run: (tx: unknown) => unknown) => run({})),
  };
  const whatsapp = {
    dispatchIntent: jest.fn(),
    rejectedCollection: jest.fn(),
  };
  const queue = {
    addOutboundIntentJob: jest.fn().mockResolvedValue(undefined),
  };
  const emailQueue = { addJob: jest.fn() };
  const sender = {
    prepare: jest
      .fn()
      .mockResolvedValue({ status: 'QUEUED', intentId: 'intent-1' }),
  };
  const pending = { block: jest.fn().mockResolvedValue({ id: 'pending-1' }) };
  const worker = new MessageWorkerService(
    {} as ConfigService,
    prisma as unknown as PrismaService,
    {} as RateLimitService,
    {} as MessagingLimitService,
    {} as PaymentService,
    {} as SpintaxService,
    queue as unknown as MessageQueueService,
    whatsapp as unknown as WhatsappService,
    emailQueue as unknown as EmailQueueService,
    {} as EmailService,
    {} as EmailTemplatesService,
    {} as PublicPaymentLinkService,
    sender as unknown as TemplateSendPreparerService,
    pending as unknown as TemplatePendingService,
  ) as unknown as WorkerInternals;
  return { worker, prisma, whatsapp, queue, emailQueue, sender, pending };
}

const invoice = {
  id: 'invoice-1',
  companyId: 'company-1',
  debtor: { id: 'debtor-1', name: 'Maria', whatsappOptIn: true },
};

describe('MessageWorkerService template sends', () => {
  it('holds a legacy send-message job instead of sending its old parameters', async () => {
    const { worker, pending, whatsapp } = setup();
    await worker.processSendMessageJob(legacyJob);
    expect(pending.block).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        code: 'LEGACY_PAYLOAD',
        request: expect.objectContaining({
          logicalKey: 'collection:company-1:invoice-1:step-1:WHATSAPP',
          selection: { mode: 'UNCONFIGURED' },
          ruleStepId: 'step-1',
        }) as unknown,
      }),
    );
    expect(whatsapp.dispatchIntent).not.toHaveBeenCalled();
  });

  it('leaves an existing intent of the same communication to its own lifecycle', async () => {
    const { worker, pending, prisma } = setup();
    prisma.communicationOutboundIntent.findFirst.mockResolvedValue({
      id: 'intent-legacy',
    });
    await worker.processSendMessageJob(legacyJob);
    expect(pending.block).not.toHaveBeenCalled();
  });

  it('initial_charge_requires_emission_default', async () => {
    const { worker, sender, queue } = setup();
    sender.prepare.mockResolvedValue({
      status: 'BLOCKED',
      pendingId: 'pending-1',
      code: 'DEFAULT_MISSING',
    });
    await expect(
      worker.prepareInitialWhatsapp(
        { invoiceId: 'invoice-1', companyId: 'company-1', source: 'MANUAL' },
        invoice,
      ),
    ).resolves.toBe(false);
    expect(sender.prepare).toHaveBeenCalledWith({
      logicalKey: 'collection:company-1:invoice-1:initial:WHATSAPP',
      origin: 'COLLECTION',
      context: {
        companyId: 'company-1',
        invoiceId: 'invoice-1',
        debtorId: 'debtor-1',
      },
      selection: { mode: 'DEFAULT', purpose: 'EMISSION' },
    });
    expect(queue.addOutboundIntentJob).not.toHaveBeenCalled();
  });

  it('a manual re-send of selected invoices is its own communication', async () => {
    const { worker, sender, queue } = setup();
    await worker.prepareInitialWhatsapp(
      {
        invoiceId: 'invoice-1',
        companyId: 'company-1',
        source: 'SELECTED',
        requestId: '1700000000000',
      },
      invoice,
    );
    expect(sender.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        logicalKey:
          'collection:company-1:invoice-1:selected-1700000000000:WHATSAPP',
      }),
    );
    expect(queue.addOutboundIntentJob).toHaveBeenCalledWith('intent-1');
  });

  it('completes a held outbound job without failure record, retry or email fallback', async () => {
    const { worker, whatsapp, emailQueue } = setup();
    whatsapp.dispatchIntent.mockRejectedValue(
      new TemplatePolicyError('NOT_GRANTED'),
    );
    await expect(
      worker.processJob({
        name: 'outbound-intent',
        data: { intentId: 'intent-1' },
      } as Job<WhatsAppQueueJob>),
    ).resolves.toBeUndefined();
    expect(whatsapp.rejectedCollection).not.toHaveBeenCalled();
    expect(emailQueue.addJob).not.toHaveBeenCalled();
  });
});
