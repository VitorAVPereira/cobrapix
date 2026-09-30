import type { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
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
  queueInitialEmail(
    data: InitialChargeJob,
    invoice: unknown,
    email: string,
    paymentData: unknown,
  ): Promise<boolean>;
}

const duplicate = () =>
  new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: 'test',
  });

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
    content: '{{saudacao}}, {{nome_devedor}}.',
    greeting: 'Olá',
    instructions: '',
    signature: '',
  });
  const emailTemplates = {
    resolveForRule: jest.fn().mockResolvedValue(template('Etapa inicial')),
    findActiveOrDefault: jest.fn().mockResolvedValue(template('Padrão')),
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
  billingTypeLabel: 'Bolix',
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

describe('First message follows the rule "Inicial" step', () => {
  it('uses the Inicial WhatsApp step choice and claims the step', async () => {
    const { worker, sender, prisma, queue } = setup();
    await expect(
      worker.prepareInitialWhatsapp(automatic, withRule),
    ).resolves.toBe(true);
    expect(prisma.collectionAttempt.create).toHaveBeenCalledWith({
      data: {
        companyId: 'company-1',
        invoiceId: 'invoice-1',
        ruleStepId: 'step-whatsapp',
        channel: 'WHATSAPP',
        status: 'QUEUED',
      },
    });
    expect(sender.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        logicalKey: 'collection:company-1:invoice-1:initial:WHATSAPP',
        selection: { mode: 'EXPLICIT', templateId: 'template-b' },
        ruleStepId: 'step-whatsapp',
      }),
    );
    expect(queue.addOutboundIntentJob).toHaveBeenCalledWith('intent-1');
  });

  it('does not send when the rule already sent its Inicial step', async () => {
    const { worker, sender, prisma } = setup();
    prisma.collectionAttempt.create.mockRejectedValue(duplicate());
    await expect(
      worker.prepareInitialWhatsapp(automatic, withRule),
    ).resolves.toBe(false);
    expect(sender.prepare).not.toHaveBeenCalled();
    expect(prisma.collectionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actionType: 'INITIAL_CHARGE_SKIPPED',
      }) as unknown,
    });
  });

  it('a retry of the same job finds its own message instead of skipping', async () => {
    const { worker, sender, prisma } = setup();
    prisma.collectionAttempt.create.mockRejectedValue(duplicate());
    prisma.communicationOutboundIntent.findFirst.mockResolvedValue({
      id: 'intent-1',
    });
    await expect(
      worker.prepareInitialWhatsapp(automatic, withRule),
    ).resolves.toBe(true);
    // The existing intent is returned by the idempotent preparation.
    expect(sender.prepare).toHaveBeenCalledWith(
      expect.not.objectContaining({ ruleStepId: 'step-whatsapp' }),
    );
  });

  it('returns the step to the rule when nothing was prepared', async () => {
    const { worker, sender, prisma } = setup();
    sender.prepare.mockRejectedValue(new Error('database unavailable'));
    await expect(
      worker.prepareInitialWhatsapp(automatic, withRule),
    ).rejects.toThrow('database unavailable');
    expect(prisma.collectionAttempt.deleteMany).toHaveBeenCalledWith({
      where: {
        companyId: 'company-1',
        invoiceId: 'invoice-1',
        ruleStepId: 'step-whatsapp',
        channel: 'WHATSAPP',
        status: 'QUEUED',
      },
    });
  });

  it('a selected send uses the step template even after the step was sent', async () => {
    const { worker, sender, prisma } = setup();
    prisma.collectionAttempt.create.mockRejectedValue(duplicate());
    await worker.prepareInitialWhatsapp(
      { ...automatic, source: 'SELECTED', requestId: '1700000000000' },
      withRule,
    );
    expect(sender.prepare).toHaveBeenCalledWith({
      logicalKey:
        'collection:company-1:invoice-1:selected-1700000000000:WHATSAPP',
      origin: 'COLLECTION',
      context: {
        companyId: 'company-1',
        invoiceId: 'invoice-1',
        debtorId: 'debtor-1',
      },
      selection: { mode: 'EXPLICIT', templateId: 'template-b' },
    });
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

  it('the first e-mail uses the Inicial e-mail step template and claims the step', async () => {
    const { worker, emailTemplates, emailQueue, prisma } = setup();
    await expect(
      worker.queueInitialEmail(
        automatic,
        withRule,
        'maria@exemplo.test',
        paymentData,
      ),
    ).resolves.toBe(true);
    expect(emailTemplates.resolveForRule).toHaveBeenCalledWith(
      'company-1',
      'email-template-inicial',
    );
    expect(emailTemplates.findActiveOrDefault).not.toHaveBeenCalled();
    expect(prisma.collectionAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ruleStepId: 'step-email',
        channel: 'EMAIL',
      }) as unknown,
    });
    expect(emailQueue.addJob).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Etapa inicial',
        ruleStepId: 'step-email',
      }),
    );
    expect(prisma.collectionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actionType: 'EMAIL_QUEUED' }) as unknown,
    });
  });

  it('without an Inicial e-mail step the default template is used, as before', async () => {
    const { worker, emailTemplates, emailQueue, prisma } = setup();
    await worker.queueInitialEmail(
      automatic,
      { ...withRule, debtor: { ...withRule.debtor, collectionProfile: null } },
      'maria@exemplo.test',
      paymentData,
    );
    expect(emailTemplates.findActiveOrDefault).toHaveBeenCalledWith(
      'company-1',
      null,
    );
    expect(prisma.collectionAttempt.create).not.toHaveBeenCalled();
    expect(emailQueue.addJob).toHaveBeenCalledWith(
      expect.not.objectContaining({ ruleStepId: expect.anything() as unknown }),
    );
  });

  it('an unavailable Inicial e-mail template skips the e-mail without falling back', async () => {
    const { worker, emailTemplates, emailQueue, prisma } = setup();
    emailTemplates.resolveForRule.mockRejectedValue(new Error('inactive'));
    await expect(
      worker.queueInitialEmail(
        automatic,
        withRule,
        'maria@exemplo.test',
        paymentData,
      ),
    ).resolves.toBe(false);
    expect(emailTemplates.findActiveOrDefault).not.toHaveBeenCalled();
    expect(prisma.collectionAttempt.create).not.toHaveBeenCalled();
    expect(emailQueue.addJob).not.toHaveBeenCalled();
    expect(prisma.collectionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actionType: 'EMAIL_SKIPPED' }) as unknown,
    });
  });

  it('the first e-mail is not sent again when the rule already sent the step', async () => {
    const { worker, emailQueue, prisma } = setup();
    prisma.collectionAttempt.create.mockRejectedValue(duplicate());
    await expect(
      worker.queueInitialEmail(
        automatic,
        withRule,
        'maria@exemplo.test',
        paymentData,
      ),
    ).resolves.toBe(false);
    expect(emailQueue.addJob).not.toHaveBeenCalled();
  });
});
