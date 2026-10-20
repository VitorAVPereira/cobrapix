import { BillingMethod, type InvoiceStatus, type Prisma } from '@prisma/client';
import { BillingService } from './billing.service.ts';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentService } from '../payment/payment.service';
import { MessageQueueService } from '../queue/message.queue';
import { SpintaxService } from '../queue/services/spintax.service';
import { CollectionRuleEngine } from './collection-rule-engine';
import { EmailQueueService } from '../email/email.queue';
import { EmailService } from '../email/email.service';
import { EmailTemplatesService } from '../email/email-templates.service';
import { TemplateSendPreparerService } from '../templates/template-send-preparer.service';

function decimal(value: number): { toNumber(): number; valueOf(): number } {
  return { toNumber: () => value, valueOf: () => value };
}

interface TestInvoiceOverrides {
  id?: string;
  status?: InvoiceStatus;
  billingType?: string | null;
  gatewayId?: string | null;
  efiTxid?: string | null;
  efiChargeId?: string | null;
  pixPayload?: string | null;
  efiPixCopiaECola?: string | null;
  boletoLinhaDigitavel?: string | null;
  boletoLink?: string | null;
  boletoPdf?: string | null;
  email?: string | null;
  whatsappOptIn?: boolean;
}

function buildCompany(): {
  id: string;
  corporateName: string;
  whatsappStatus: string;
  whatsappInstanceId: string;
  collectionReminderDays: number[];
  preferredBillingMethod: BillingMethod;
} {
  return {
    id: 'company-1',
    corporateName: 'Empresa Teste',
    whatsappStatus: 'CONNECTED',
    whatsappInstanceId: 'cobra-whats',
    collectionReminderDays: [0],
    preferredBillingMethod: 'PIX',
  };
}

function buildInvoice(overrides: TestInvoiceOverrides = {}) {
  return {
    id: overrides.id ?? 'invoice-1',
    companyId: 'company-1',
    debtorId: 'debtor-1',
    originalAmount: decimal(150),
    dueDate: new Date('2026-04-28T12:00:00.000Z'),
    status: overrides.status ?? 'PENDING',
    gatewayId: overrides.gatewayId ?? null,
    pixPayload: overrides.pixPayload ?? null,
    pixExpiresAt: null,
    efiTxid: overrides.efiTxid ?? null,
    efiChargeId: overrides.efiChargeId ?? null,
    efiLocId: null,
    efiPixCopiaECola: overrides.efiPixCopiaECola ?? null,
    boletoLinhaDigitavel: overrides.boletoLinhaDigitavel ?? null,
    boletoLink: overrides.boletoLink ?? null,
    boletoPdf: overrides.boletoPdf ?? null,
    splitConfigId: null,
    notificationToken: null,
    gatewayStatusRaw: null,
    discountApplied: null,
    billingType: overrides.billingType ?? 'PIX',
    recurrencePeriod: null,
    collectionLogs: [],
    debtor: {
      id: 'debtor-1',
      companyId: 'company-1',
      name: 'Maria Silva',
      document: null,
      phoneNumber: '11999999999',
      email: overrides.email ?? null,
      whatsappOptIn: overrides.whatsappOptIn ?? true,
      gatewayCustomerId: null,
      useGlobalBillingSettings: true,
      collectionReminderDays: [],
      autoDiscountEnabled: null,
      autoDiscountDaysAfterDue: null,
      autoDiscountPercentage: null,
      preferredBillingMethod: null,
      createdAt: new Date('2026-04-01T12:00:00.000Z'),
      updatedAt: new Date('2026-04-01T12:00:00.000Z'),
    },
    createdAt: new Date('2026-04-01T12:00:00.000Z'),
    updatedAt: new Date('2026-04-01T12:00:00.000Z'),
  };
}

function createService(input: {
  company?: ReturnType<typeof buildCompany>;
  invoices?: ReturnType<typeof buildInvoice>[];
  updatedInvoice?: ReturnType<typeof buildInvoice> | null;
  createPayment?: jest.Mock;
  centralChannelEnabled?: boolean;
  financiallyActive?: boolean;
}) {
  const company = input.company ?? buildCompany();
  const invoices = input.invoices ?? [];
  const createPayment = input.createPayment ?? jest.fn().mockResolvedValue({});

  const prisma = {
    platformIntegrationState: {
      findUnique: jest.fn().mockResolvedValue({
        enabled: input.centralChannelEnabled ?? true,
      }),
    },
    company: {
      findUnique: jest.fn().mockResolvedValue(company),
    },
    invoice: {
      findMany: jest.fn().mockResolvedValue(invoices),
      findFirst: jest.fn().mockResolvedValue(input.updatedInvoice ?? null),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    debtor: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    collectionLog: {
      create: jest.fn().mockResolvedValue({ id: 'log-1' }),
    },
    collectionAttempt: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  } as unknown as PrismaService;

  const messageQueue = {
    addOutboundIntentJob: jest.fn().mockResolvedValue(undefined),
    addSelectedInitialChargeJobs: jest.fn().mockResolvedValue(undefined),
  } as unknown as MessageQueueService;

  const spintaxService = {
    process: jest.fn((text: string) => text),
  } as unknown as SpintaxService;

  const paymentService = {
    createPayment,
    hasActiveFinancialProfile: jest
      .fn()
      .mockResolvedValue(input.financiallyActive ?? true),
  } as unknown as PaymentService;

  const ruleEngine = {
    planContact: jest
      .fn()
      .mockResolvedValue(
        contact([{ ruleStepId: 'step-1', channel: 'WHATSAPP' }]),
      ),
    claimContact: jest.fn().mockResolvedValue(true),
  } as unknown as CollectionRuleEngine;

  const emailQueue = {
    addBulk: jest.fn().mockResolvedValue(undefined),
  } as unknown as EmailQueueService;

  const emailService = {
    buildCollectionEmailHtml: jest.fn().mockReturnValue('<html></html>'),
  } as unknown as EmailService;

  const resolvedEmail = {
    id: 'email-template-1',
    slug: 'vencimento-hoje',
    name: 'Vencimento hoje',
    subject: '{{nome_empresa}}: cobranca de {{valor}}',
    content:
      'Ola {{nome_devedor}}, acesse {{payment_link}} ate {{data_vencimento}}.',
    isActive: true,
    greeting: 'Olá',
    instructions: 'Acesse o pagamento seguro.',
    signature: 'Equipe Empresa Teste',
  };
  const emailTemplatesService = {
    resolveForPurpose: jest.fn().mockResolvedValue(resolvedEmail),
  } as unknown as EmailTemplatesService;
  const templateSender = {
    prepare: jest
      .fn()
      .mockResolvedValue({ status: 'QUEUED', intentId: 'intent-1' }),
  } as unknown as TemplateSendPreparerService;

  return {
    service: new BillingService(
      prisma,
      messageQueue,
      spintaxService,
      paymentService,
      ruleEngine,
      emailQueue,
      emailService,
      emailTemplatesService,
      templateSender,
    ),
    prisma: prisma as unknown as {
      platformIntegrationState: { findUnique: jest.Mock };
      collectionLog: { create: jest.Mock };
      collectionAttempt: { updateMany: jest.Mock };
      debtor: { updateMany: jest.Mock };
      invoice: {
        findMany: jest.Mock;
        update: jest.Mock;
        updateMany: jest.Mock;
      };
    },
    templateSender: templateSender as unknown as { prepare: jest.Mock },
    messageQueue: messageQueue as unknown as {
      addOutboundIntentJob: jest.Mock;
      addSelectedInitialChargeJobs: jest.Mock;
    },
    ruleEngine: ruleEngine as unknown as {
      planContact: jest.Mock;
      claimContact: jest.Mock;
    },
    emailQueue: emailQueue as unknown as {
      addBulk: jest.Mock;
    },
    emailService: emailService as unknown as {
      buildCollectionEmailHtml: jest.Mock;
    },
    emailTemplatesService: emailTemplatesService as unknown as {
      resolveForPurpose: jest.Mock;
    },
    resolvedEmail,
    createPayment,
  };
}

/** A contact of the rule as the engine plans it. */
function contact(
  steps: Array<{ ruleStepId: string; channel: 'WHATSAPP' | 'EMAIL' }>,
  moment = 'DUE_TODAY',
) {
  return { kind: 'SEND', contact: { day: 0, steps }, moment };
}

function logged(
  prisma: { collectionLog: { create: jest.Mock } },
  actionType: string,
) {
  return prisma.collectionLog.create.mock.calls.some(
    ([args]: [{ data: { actionType: string } }]) =>
      args.data.actionType === actionType,
  );
}

const paidPix = {
  gatewayId: 'tx-invoice-1',
  efiTxid: 'tx-invoice-1',
  efiPixCopiaECola: 'pix-copia-e-cola',
};

describe('BillingService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-28T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('prepares the WhatsApp step with the automatic template of the moment and the charge method', async () => {
    const fixture = createService({ invoices: [buildInvoice(paidPix)] });
    fixture.ruleEngine.planContact.mockResolvedValue(
      contact([{ ruleStepId: 'step-1', channel: 'WHATSAPP' }], 'BEFORE_DUE'),
    );

    expect(await fixture.service.executeBilling('company-1')).toEqual({
      queued: 1,
      skipped: 0,
    });
    expect(fixture.ruleEngine.claimContact).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'invoice-1' }),
      [{ ruleStepId: 'step-1', channel: 'WHATSAPP', status: 'QUEUED' }],
    );
    expect(fixture.templateSender.prepare).toHaveBeenCalledWith({
      logicalKey: 'collection:company-1:invoice-1:step-1:WHATSAPP',
      origin: 'COLLECTION',
      context: {
        companyId: 'company-1',
        invoiceId: 'invoice-1',
        debtorId: 'debtor-1',
      },
      selection: {
        mode: 'AUTOMATIC',
        purpose: 'BEFORE_DUE',
        billingMethod: 'PIX',
        ruleStepId: 'step-1',
      },
      ruleStepId: 'step-1',
    });
    expect(fixture.messageQueue.addOutboundIntentJob).toHaveBeenCalledWith(
      'intent-1',
    );
    expect(logged(fixture.prisma, 'WHATSAPP_QUEUED')).toBe(true);
  });

  it('sends every channel of the contact together', async () => {
    const fixture = createService({
      invoices: [buildInvoice({ ...paidPix, email: 'maria@example.test' })],
    });
    fixture.ruleEngine.planContact.mockResolvedValue(
      contact([
        { ruleStepId: 'step-email', channel: 'EMAIL' },
        { ruleStepId: 'step-whatsapp', channel: 'WHATSAPP' },
      ]),
    );

    expect(await fixture.service.executeBilling('company-1')).toEqual({
      queued: 2,
      skipped: 0,
    });
    expect(fixture.ruleEngine.claimContact).toHaveBeenCalledTimes(1);
    expect(fixture.templateSender.prepare).toHaveBeenCalledTimes(1);
    expect(fixture.emailQueue.addBulk).toHaveBeenCalledWith([
      expect.objectContaining({ ruleStepId: 'step-email' }),
    ]);
  });

  it('sends nothing when another run already claimed a contact in the last 24 h', async () => {
    const fixture = createService({ invoices: [buildInvoice(paidPix)] });
    fixture.ruleEngine.claimContact.mockResolvedValue(false);

    expect(await fixture.service.executeBilling('company-1')).toEqual({
      queued: 0,
      skipped: 1,
    });
    expect(fixture.templateSender.prepare).not.toHaveBeenCalled();
    expect(fixture.emailQueue.addBulk).not.toHaveBeenCalled();
  });

  it('a contact waiting for the 24 h interval generates no charge and no message', async () => {
    const fixture = createService({ invoices: [buildInvoice()] });
    fixture.ruleEngine.planContact.mockResolvedValue({
      kind: 'WAIT',
      reason: 'MIN_INTERVAL',
    });

    expect(await fixture.service.executeBilling('company-1')).toEqual({
      queued: 0,
      skipped: 1,
    });
    expect(fixture.createPayment).not.toHaveBeenCalled();
    expect(fixture.ruleEngine.claimContact).not.toHaveBeenCalled();
  });

  it('a missing template is held for review; nothing else is tried', async () => {
    const fixture = createService({
      invoices: [buildInvoice({ ...paidPix, email: 'maria@example.test' })],
    });
    fixture.templateSender.prepare.mockResolvedValue({
      status: 'BLOCKED',
      pendingId: 'pending-1',
      code: 'COLLECTION_TEMPLATE_MISSING',
    });

    expect(await fixture.service.executeBilling('company-1')).toEqual({
      queued: 0,
      skipped: 1,
    });
    expect(fixture.templateSender.prepare).toHaveBeenCalledTimes(1);
    expect(fixture.messageQueue.addOutboundIntentJob).not.toHaveBeenCalled();
    expect(fixture.emailQueue.addBulk).not.toHaveBeenCalled();
    expect(fixture.prisma.invoice.update).not.toHaveBeenCalled();
    expect(logged(fixture.prisma, 'WHATSAPP_TEMPLATE_HELD')).toBe(true);
  });

  it('e-mail uses the model of the moment and never prepares WhatsApp for it', async () => {
    const fixture = createService({
      invoices: [buildInvoice({ ...paidPix, email: 'maria@example.test' })],
    });
    fixture.ruleEngine.planContact.mockResolvedValue(
      contact([{ ruleStepId: 'step-2', channel: 'EMAIL' }], 'BEFORE_DUE'),
    );

    expect(await fixture.service.executeBilling('company-1')).toEqual({
      queued: 1,
      skipped: 0,
    });
    expect(
      fixture.emailTemplatesService.resolveForPurpose,
    ).toHaveBeenCalledWith('company-1', 'BEFORE_DUE');
    expect(fixture.templateSender.prepare).not.toHaveBeenCalled();
  });

  it('an e-mail model the company turned off is not replaced by another one', async () => {
    const fixture = createService({
      invoices: [buildInvoice({ ...paidPix, email: 'maria@example.test' })],
    });
    fixture.ruleEngine.planContact.mockResolvedValue(
      contact([{ ruleStepId: 'step-2', channel: 'EMAIL' }]),
    );
    fixture.emailTemplatesService.resolveForPurpose.mockResolvedValue({
      ...fixture.resolvedEmail,
      isActive: false,
    });

    expect(await fixture.service.executeBilling('company-1')).toEqual({
      queued: 0,
      skipped: 1,
    });
    expect(fixture.emailQueue.addBulk).not.toHaveBeenCalled();
    expect(fixture.prisma.collectionAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }) as unknown,
      }),
    );
    expect(logged(fixture.prisma, 'EMAIL_SKIPPED')).toBe(true);
  });

  it('records a missing opt-in as a failed attempt without preparing a message', async () => {
    const fixture = createService({
      invoices: [buildInvoice({ ...paidPix, whatsappOptIn: false })],
    });

    expect(await fixture.service.executeBilling('company-1')).toEqual({
      queued: 0,
      skipped: 1,
    });
    expect(fixture.templateSender.prepare).not.toHaveBeenCalled();
    expect(logged(fixture.prisma, 'WHATSAPP_OPT_IN_REQUIRED')).toBe(true);
    expect(fixture.ruleEngine.claimContact).toHaveBeenCalledWith(
      expect.anything(),
      [
        {
          ruleStepId: 'step-1',
          channel: 'WHATSAPP',
          status: 'FAILED',
          errorDetails: 'Opt-in WhatsApp ausente.',
        },
      ],
    );
  });

  it('gera pagamento antes de preparar a mensagem de cobranca', async () => {
    const invoice = buildInvoice();
    const updatedInvoice = buildInvoice({
      gatewayId: 'tx-invoice-1',
      efiTxid: 'tx-invoice-1',
      pixPayload: 'pix-copia-e-cola',
      efiPixCopiaECola: 'pix-copia-e-cola',
    });
    const { service, createPayment, prisma, templateSender } = createService({
      invoices: [invoice],
      updatedInvoice,
    });

    const result = await service.executeBilling('company-1');

    expect(result).toEqual({ queued: 1, skipped: 0 });
    expect(createPayment).toHaveBeenCalledWith('invoice-1', 'company-1', 'PIX');
    expect(createPayment.mock.invocationCallOrder[0]).toBeLessThan(
      templateSender.prepare.mock.invocationCallOrder[0]!,
    );
    expect(logged(prisma, 'PAYMENT_GENERATED')).toBe(true);
    expect(logged(prisma, 'WHATSAPP_QUEUED')).toBe(true);
  });

  it('chooses the template by the payment method of the charge', async () => {
    const boleto = buildInvoice({
      billingType: 'BOLETO',
      gatewayId: '12345',
      efiChargeId: '12345',
      boletoLinhaDigitavel: '00190000000',
      boletoLink: 'https://boleto.example/12345',
    });
    const fixture = createService({ invoices: [buildInvoice(paidPix)] });
    await fixture.service.executeBilling('company-1');
    expect(fixture.templateSender.prepare).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selection: expect.objectContaining({ billingMethod: 'PIX' }) as unknown,
      }),
    );

    const boletoFixture = createService({ invoices: [boleto] });
    await boletoFixture.service.executeBilling('company-1');
    expect(boletoFixture.templateSender.prepare).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selection: expect.objectContaining({
          billingMethod: 'BOLETO',
        }) as unknown,
      }),
    );
  });

  it('reutiliza pagamento existente sem gerar cobranca duplicada', async () => {
    const invoice = buildInvoice({
      billingType: 'BOLETO',
      gatewayId: '12345',
      efiChargeId: '12345',
      boletoLinhaDigitavel: '00190000000',
      boletoLink: 'https://boleto.example/12345',
    });
    const { service, createPayment, prisma, templateSender } = createService({
      invoices: [invoice],
    });

    const result = await service.executeBilling('company-1');

    expect(result).toEqual({ queued: 1, skipped: 0 });
    expect(createPayment).not.toHaveBeenCalled();
    expect(templateSender.prepare).toHaveBeenCalledTimes(1);
    expect(logged(prisma, 'PAYMENT_REUSED')).toBe(true);
  });

  it('enfileira rascunhos e pendentes selecionados somente da empresa autenticada', async () => {
    const invoices = [
      buildInvoice({ id: 'draft', status: 'DRAFT' }),
      buildInvoice({ id: 'pending', status: 'PENDING' }),
      buildInvoice({ id: 'paid', status: 'PAID' }),
      buildInvoice({ id: 'canceled', status: 'CANCELED' }),
      { ...buildInvoice({ id: 'other-company' }), companyId: 'company-2' },
      buildInvoice({ id: 'not-selected' }),
    ];
    const { service, prisma, messageQueue } = createService({ invoices });
    prisma.invoice.findMany.mockImplementation(
      (args: Prisma.InvoiceFindManyArgs) => {
        const where = args.where;
        const statuses =
          typeof where?.status === 'string'
            ? [where.status]
            : where?.status?.in;
        const ids = typeof where?.id === 'object' ? where.id.in : [];
        return Promise.resolve(
          invoices.filter(
            (invoice) =>
              invoice.companyId === where?.companyId &&
              Array.isArray(ids) &&
              ids.includes(invoice.id) &&
              Array.isArray(statuses) &&
              statuses.includes(invoice.status),
          ),
        );
      },
    );

    const result = await service.enqueueSelectedInvoices('company-1', [
      'draft',
      'pending',
      'paid',
      'canceled',
      'other-company',
      'draft',
    ]);

    expect(result).toEqual({ requested: 5, queued: 2, skipped: 3 });
    expect(messageQueue.addSelectedInitialChargeJobs).toHaveBeenCalledWith([
      {
        invoiceId: 'draft',
        companyId: 'company-1',
        source: 'SELECTED',
        channels: ['WHATSAPP'],
      },
      {
        invoiceId: 'pending',
        companyId: 'company-1',
        source: 'SELECTED',
        channels: ['WHATSAPP'],
      },
    ]);
  });

  it('bloqueia WhatsApp pausado antes de alterar contatos ou enfileirar', async () => {
    const { service, prisma, messageQueue } = createService({
      invoices: [buildInvoice()],
      centralChannelEnabled: false,
    });

    await expect(
      service.enqueueSelectedInvoices('company-1', ['invoice-1'], {
        contacts: [{ invoiceId: 'invoice-1', phoneNumber: '+5511998887777' }],
      }),
    ).rejects.toMatchObject({
      status: 503,
      response: { code: 'CENTRAL_CHANNEL_PAUSED' },
    });
    expect(prisma.platformIntegrationState.findUnique).toHaveBeenCalledWith({
      where: { integration: 'META' },
    });
    expect(prisma.debtor.updateMany).not.toHaveBeenCalled();
    expect(messageQueue.addSelectedInitialChargeJobs).not.toHaveBeenCalled();
  });

  it('permite EMAIL sem consultar a pausa do WhatsApp central', async () => {
    const { service, prisma, messageQueue } = createService({
      invoices: [buildInvoice()],
      centralChannelEnabled: false,
    });

    await expect(
      service.enqueueSelectedInvoices('company-1', ['invoice-1'], {
        channels: ['EMAIL'],
      }),
    ).resolves.toEqual({ requested: 1, queued: 1, skipped: 0 });
    expect(prisma.platformIntegrationState.findUnique).not.toHaveBeenCalled();
    expect(messageQueue.addSelectedInitialChargeJobs).toHaveBeenCalledTimes(1);
  });

  it('mantem a exigencia de ativacao financeira para o envio selecionado', async () => {
    const { service, prisma, messageQueue } = createService({
      invoices: [buildInvoice({ status: 'DRAFT' })],
      financiallyActive: false,
    });

    await expect(
      service.enqueueSelectedInvoices('company-1', ['invoice-1']),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'FINANCIAL_PROFILE_NOT_READY' },
    });
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
    expect(messageQueue.addSelectedInitialChargeJobs).not.toHaveBeenCalled();
  });

  it('atualiza contatos informados antes de enfileirar cobrancas selecionadas', async () => {
    const invoice = buildInvoice();
    const { service, messageQueue, prisma } = createService({
      invoices: [invoice],
    });

    const result = await service.enqueueSelectedInvoices(
      'company-1',
      ['invoice-1'],
      {
        channels: ['EMAIL', 'WHATSAPP'],
        contacts: [
          {
            invoiceId: 'invoice-1',
            email: 'novo@email.com',
            phoneNumber: '+5511998887777',
            whatsappOptIn: true,
          },
        ],
      },
    );

    expect(result).toEqual({ requested: 1, queued: 1, skipped: 0 });
    expect(prisma.debtor.updateMany).toHaveBeenCalledWith({
      where: { id: 'debtor-1', companyId: 'company-1' },
      data: expect.objectContaining({
        email: 'novo@email.com',
        phoneNumber: '+5511998887777',
        whatsappOptIn: true,
        whatsappOptInAt: expect.any(Date) as Date,
        whatsappOptInSource: 'manual_send_modal',
      }) as unknown,
    });
    expect(messageQueue.addSelectedInitialChargeJobs).toHaveBeenCalledWith([
      {
        invoiceId: 'invoice-1',
        companyId: 'company-1',
        source: 'SELECTED',
        channels: ['EMAIL', 'WHATSAPP'],
      },
    ]);
  });

  it('nao enfileira mensagem quando a geracao de pagamento falha', async () => {
    const invoice = buildInvoice();
    const createPayment = jest
      .fn()
      .mockRejectedValue(new Error('gateway indisponivel'));
    const { service, messageQueue, prisma } = createService({
      invoices: [invoice],
      createPayment,
    });

    const result = await service.executeBilling('company-1');

    expect(result).toEqual({ queued: 0, skipped: 1 });
    expect(messageQueue.addOutboundIntentJob).not.toHaveBeenCalled();
    expect(prisma.collectionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actionType: 'PAYMENT_GENERATION_FAILED',
          status: 'FAILED',
          description: expect.stringContaining(
            'gateway indisponivel',
          ) as string,
        }) as unknown,
      }),
    );
  });

  it('usa template de email ativo para assunto e corpo do envio EMAIL', async () => {
    const invoice = buildInvoice({
      email: 'maria@example.com',
      gatewayId: 'tx-invoice-1',
      efiTxid: 'tx-invoice-1',
      efiPixCopiaECola: 'pix-copia-e-cola',
    });
    const {
      service,
      ruleEngine,
      emailQueue,
      emailService,
      emailTemplatesService,
    } = createService({
      invoices: [invoice],
    });
    ruleEngine.planContact.mockResolvedValue(
      contact([{ ruleStepId: 'step-1', channel: 'EMAIL' }]),
    );

    const result = await service.executeBilling('company-1');

    expect(result).toEqual({ queued: 1, skipped: 0 });
    expect(emailTemplatesService.resolveForPurpose).toHaveBeenCalledWith(
      'company-1',
      'DUE_TODAY',
    );
    expect(emailService.buildCollectionEmailHtml).toHaveBeenCalledWith(
      expect.objectContaining({
        bodyText: 'Ola Maria Silva, acesse pix-copia-e-cola ate 28/04/2026.',
      }),
    );
    expect(emailQueue.addBulk).toHaveBeenCalledWith([
      expect.objectContaining({
        email: 'maria@example.com',
        pixCopyPaste: 'pix-copia-e-cola',
        subject: expect.stringMatching(
          /^Empresa Teste: cobranca de R\$\s150,00$/,
        ) as string,
      }),
    ]);
  });
});
