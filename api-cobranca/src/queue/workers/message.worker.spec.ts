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
    billingMethod?: string,
  ): Promise<boolean>;
  queueInitialEmail(
    invoice: unknown,
    email: string,
    paymentData: unknown,
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
    whatsappTemplatePendingSend: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    collectionAttempt: {
      create: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      upsert: jest.fn().mockResolvedValue({}),
    },
    invoice: { findFirst: jest.fn().mockResolvedValue(null) },
    collectionLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((run: (tx: unknown) => unknown) => run({})),
  };
  const template = (subject: string) => ({
    subject,
    isActive: true,
    content: '{{saudacao}}, {{nome_devedor}}.',
    greeting: 'Olá',
    instructions: '',
    signature: '',
  });
  const emailTemplates = {
    resolveForPurpose: jest.fn().mockResolvedValue(template('Emissão')),
  };
  const emailService = { buildCollectionEmailHtml: jest.fn(() => '<p/>') };
  const whatsapp = {
    dispatchIntent: jest.fn(),
    rejectedCollection: jest.fn(),
  };
  const queue = {
    addOutboundIntentJob: jest.fn().mockResolvedValue(undefined),
  };
  const emailQueue = { addJob: jest.fn().mockResolvedValue(undefined) };
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
    { process: (text: string) => text } as unknown as SpintaxService,
    queue as unknown as MessageQueueService,
    whatsapp as unknown as WhatsappService,
    emailQueue as unknown as EmailQueueService,
    emailService as unknown as EmailService,
    emailTemplates as unknown as EmailTemplatesService,
    {} as PublicPaymentLinkService,
    sender as unknown as TemplateSendPreparerService,
    pending as unknown as TemplatePendingService,
  ) as unknown as WorkerInternals;
  return {
    worker,
    prisma,
    whatsapp,
    queue,
    emailQueue,
    sender,
    pending,
    emailTemplates,
    emailService,
  };
}

const invoice = {
  id: 'invoice-1',
  companyId: 'company-1',
  debtor: { id: 'debtor-1', name: 'Maria', whatsappOptIn: true },
};

const step = {
  isActive: true,
  templateId: null,
  emailTemplateId: null,
  whatsappSelectionMode: null,
  whatsappPurpose: null,
};
/** A profile whose "Inicial" day has an e-mail and a WhatsApp step with template B. */
const withRule = {
  ...invoice,
  dueDate: new Date('2026-10-05T12:00:00.000Z'),
  originalAmount: 150,
  company: { corporateName: 'Empresa', tradeName: null },
  debtor: {
    ...invoice.debtor,
    collectionProfile: {
      steps: [
        {
          ...step,
          id: 'step-email',
          stepOrder: 0,
          channel: 'EMAIL',
          delayDays: -30,
          emailTemplateId: 'email-template-inicial',
        },
        {
          ...step,
          id: 'step-whatsapp',
          stepOrder: 1,
          channel: 'WHATSAPP',
          delayDays: 0,
          whatsappSelectionMode: 'EXPLICIT',
          templateId: 'template-b',
        },
        {
          ...step,
          id: 'step-overdue',
          stepOrder: 2,
          channel: 'WHATSAPP',
          delayDays: 31,
          whatsappSelectionMode: 'DEFAULT',
          whatsappPurpose: 'FIRST_OVERDUE',
        },
      ],
    },
  },
};
const automatic: InitialChargeJob = {
  invoiceId: 'invoice-1',
  companyId: 'company-1',
  source: 'MANUAL',
};
const paymentData = {
  billingType: 'BOLIX',
  billingTypeLabel: 'Boleto ou PIX',
  paymentLink: 'https://app.test/pagar/token',
  paymentPageToken: 'token',
  pixCopiaECola: '000201',
  boletoLinhaDigitavel: '0019',
  boletoLink: 'https://boleto.test',
  boletoPdf: '',
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

  it('the emission message is held when its global template is missing', async () => {
    const { worker, sender, queue } = setup();
    sender.prepare.mockResolvedValue({
      status: 'BLOCKED',
      pendingId: 'pending-1',
      code: 'COLLECTION_TEMPLATE_MISSING',
    });
    await expect(
      worker.prepareInitialWhatsapp(
        { invoiceId: 'invoice-1', companyId: 'company-1', source: 'MANUAL' },
        invoice,
        'PIX',
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
      selection: {
        mode: 'AUTOMATIC',
        purpose: 'EMISSION',
        billingMethod: 'PIX',
      },
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

describe('Emission message (asked for when registering the invoice)', () => {
  it('uses the automatic EMISSION template of the method and claims no rule step', async () => {
    const { worker, sender, prisma, queue } = setup();
    await expect(
      worker.prepareInitialWhatsapp(automatic, withRule, 'BOLIX'),
    ).resolves.toBe(true);
    expect(prisma.collectionAttempt.create).not.toHaveBeenCalled();
    expect(sender.prepare).toHaveBeenCalledWith({
      logicalKey: 'collection:company-1:invoice-1:initial:WHATSAPP',
      origin: 'COLLECTION',
      context: {
        companyId: 'company-1',
        invoiceId: 'invoice-1',
        debtorId: 'debtor-1',
      },
      selection: {
        mode: 'AUTOMATIC',
        purpose: 'EMISSION',
        billingMethod: 'BOLIX',
      },
    });
    expect(queue.addOutboundIntentJob).toHaveBeenCalledWith('intent-1');
  });

  it('a selected send is its own communication with the same automatic choice', async () => {
    const { worker, sender } = setup();
    await worker.prepareInitialWhatsapp(
      { ...automatic, source: 'SELECTED', requestId: '1700000000000' },
      withRule,
      'PIX',
    );
    expect(sender.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        logicalKey:
          'collection:company-1:invoice-1:selected-1700000000000:WHATSAPP',
        selection: {
          mode: 'AUTOMATIC',
          purpose: 'EMISSION',
          billingMethod: 'PIX',
        },
      }),
    );
  });

  it('a rejected first message keeps having no e-mail fallback', async () => {
    const { worker, whatsapp, prisma, emailQueue } = setup();
    whatsapp.dispatchIntent.mockRejectedValue(new Error('invalid number'));
    whatsapp.rejectedCollection.mockResolvedValue({
      companyId: 'company-1',
      invoiceId: 'invoice-1',
      ruleStepId: 'step-whatsapp',
      emailFallback: false,
    });
    await expect(
      worker.processJob({
        name: 'outbound-intent',
        data: { intentId: 'intent-1' },
      } as Job<WhatsAppQueueJob>),
    ).rejects.toThrow('invalid number');
    expect(prisma.collectionAttempt.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { status: 'FAILED', errorDetails: 'invalid number' },
      }),
    );
    expect(prisma.invoice.findFirst).not.toHaveBeenCalled();
    expect(emailQueue.addJob).not.toHaveBeenCalled();
  });

  it('the emission e-mail uses the emission model and claims no rule step', async () => {
    const { worker, emailTemplates, emailQueue, prisma } = setup();
    await expect(
      worker.queueInitialEmail(withRule, 'maria@exemplo.test', paymentData),
    ).resolves.toBe(true);
    expect(emailTemplates.resolveForPurpose).toHaveBeenCalledWith(
      'company-1',
      'EMISSION',
    );
    expect(prisma.collectionAttempt.create).not.toHaveBeenCalled();
    expect(emailQueue.addJob).toHaveBeenCalledWith(
      expect.not.objectContaining({ ruleStepId: expect.anything() as unknown }),
    );
    expect(prisma.collectionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actionType: 'EMAIL_QUEUED' }) as unknown,
    });
  });

  it('the emission e-mail names the payment method once, without repeating the link', async () => {
    const { worker, emailQueue, emailService } = setup();
    await worker.queueInitialEmail(withRule, 'maria@exemplo.test', paymentData);
    const rendered = emailService.buildCollectionEmailHtml.mock
      .calls[0] as unknown as [{ bodyText: string; billingType: string }];
    expect(rendered[0].billingType).toBe('BOLIX');
    expect(rendered[0].bodyText).toContain('Forma de pagamento: Boleto ou PIX');
    expect(rendered[0].bodyText).not.toContain('https://app.test/pagar/token');
    expect(emailQueue.addJob).toHaveBeenCalledWith(
      expect.objectContaining({ pixCopyPaste: '000201' }),
    );
  });

  it('an emission model the company turned off skips the e-mail without another one', async () => {
    const { worker, emailTemplates, emailQueue, prisma } = setup();
    emailTemplates.resolveForPurpose.mockResolvedValue({
      subject: 'Emissão',
      isActive: false,
      content: '',
      greeting: '',
      instructions: '',
      signature: '',
    });
    await expect(
      worker.queueInitialEmail(withRule, 'maria@exemplo.test', paymentData),
    ).resolves.toBe(false);
    expect(emailQueue.addJob).not.toHaveBeenCalled();
    expect(prisma.collectionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actionType: 'EMAIL_SKIPPED' }) as unknown,
    });
  });
});
