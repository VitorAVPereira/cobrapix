import { BillingMethod } from '@prisma/client';
import { BillingService } from './billing.service.ts';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentService } from '../payment/payment.service';
import { MessageQueueService, SendMessageJob } from '../queue/message.queue';
import { SpintaxService } from '../queue/services/spintax.service';
import { CollectionRuleEngine } from './collection-rule-engine';
import { EmailQueueService } from '../email/email.queue';
import { EmailService } from '../email/email.service';

function decimal(value: number): { toNumber(): number; valueOf(): number } {
  return { toNumber: () => value, valueOf: () => value };
}

interface TestInvoiceOverrides {
  id?: string;
  billingType?: string | null;
  gatewayId?: string | null;
  efiTxid?: string | null;
  efiChargeId?: string | null;
  pixPayload?: string | null;
  efiPixCopiaECola?: string | null;
  boletoLinhaDigitavel?: string | null;
  boletoLink?: string | null;
  boletoPdf?: string | null;
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
    status: 'PENDING',
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
      email: null,
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
  templateContent?: string;
}) {
  const company = input.company ?? buildCompany();
  const invoices = input.invoices ?? [];
  const createPayment = input.createPayment ?? jest.fn().mockResolvedValue({});

  const prisma = {
    company: {
      findUnique: jest.fn().mockResolvedValue(company),
    },
    messageTemplate: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'template-1',
        slug: 'vencimento-hoje',
        content:
          input.templateContent ??
          [
            'Ola {{nome_devedor}}, sua cobranca de {{valor}} vence em {{data_vencimento}}.',
            '',
            'Forma de pagamento: {{metodo_pagamento}}',
            'Acesse/pague por aqui: {{payment_link}}',
            'Pix copia e cola: {{pix_copia_e_cola}}',
            'Linha digitavel: {{boleto_linha_digitavel}}',
            'Boleto: {{boleto_link}}',
            'PDF do boleto: {{boleto_pdf}}',
          ].join('\n'),
        isActive: true,
        metaTemplateName: null,
        metaLanguage: 'pt_BR',
      }),
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'template-1',
          slug: 'vencimento-hoje',
          content:
            input.templateContent ??
            [
              'Ola {{nome_devedor}}, sua cobranca de {{valor}} vence em {{data_vencimento}}.',
              '',
              'Forma de pagamento: {{metodo_pagamento}}',
              'Acesse/pague por aqui: {{payment_link}}',
              'Pix copia e cola: {{pix_copia_e_cola}}',
              'Linha digitavel: {{boleto_linha_digitavel}}',
              'Boleto: {{boleto_link}}',
              'PDF do boleto: {{boleto_pdf}}',
            ].join('\n'),
          isActive: true,
        },
      ]),
    },
    invoice: {
      findMany: jest.fn().mockResolvedValue(invoices),
      findFirst: jest.fn().mockResolvedValue(input.updatedInvoice ?? null),
    },
    collectionLog: {
      create: jest.fn().mockResolvedValue({ id: 'log-1' }),
    },
    collectionAttempt: {
      create: jest.fn().mockResolvedValue({ id: 'attempt-1' }),
    },
  } as unknown as PrismaService;

  const messageQueue = {
    addBulkSendMessageJobs: jest.fn().mockResolvedValue(undefined),
  } as unknown as MessageQueueService;

  const spintaxService = {
    process: jest.fn((text: string) => text),
  } as unknown as SpintaxService;

  const paymentService = {
    createPayment,
  } as unknown as PaymentService;

  const ruleEngine = {
    getNextStep: jest.fn().mockResolvedValue({
      ruleStepId: 'step-1',
      channel: 'WHATSAPP',
      templateId: 'template-1',
      delayDays: 0,
    }),
  } as unknown as CollectionRuleEngine;

  const emailQueue = {
    addBulk: jest.fn().mockResolvedValue(undefined),
  } as unknown as EmailQueueService;

  const emailService = {
    buildCollectionEmailHtml: jest.fn().mockReturnValue('<html></html>'),
  } as unknown as EmailService;

  return {
    service: new BillingService(
      prisma,
      messageQueue,
      spintaxService,
      paymentService,
      ruleEngine,
      emailQueue,
      emailService,
    ),
    prisma: prisma as unknown as {
      collectionLog: { create: jest.Mock };
    },
    messageQueue: messageQueue as unknown as {
      addBulkSendMessageJobs: jest.Mock;
    },
    createPayment,
  };
}

function getQueuedMessage(messageQueue: {
  addBulkSendMessageJobs: jest.Mock;
}): string {
  const firstCall = messageQueue.addBulkSendMessageJobs.mock.calls[0] as
    | [SendMessageJob[]]
    | undefined;
  const firstJob = firstCall?.[0][0];

  if (!firstJob) {
    throw new Error('Nenhuma mensagem enfileirada no teste.');
  }

  return firstJob.message;
}

describe('BillingService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-28T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('gera pagamento antes de enfileirar a mensagem de cobranca', async () => {
    const invoice = buildInvoice();
    const updatedInvoice = buildInvoice({
      gatewayId: 'tx-invoice-1',
      efiTxid: 'tx-invoice-1',
      pixPayload: 'pix-copia-e-cola',
      efiPixCopiaECola: 'pix-copia-e-cola',
    });
    const { service, messageQueue, createPayment, prisma } = createService({
      invoices: [invoice],
      updatedInvoice,
    });

    const result = await service.executeBilling('company-1');

    expect(result).toEqual({ queued: 1, skipped: 0 });
    expect(createPayment).toHaveBeenCalledWith('invoice-1', 'company-1', 'PIX');
    expect(messageQueue.addBulkSendMessageJobs).toHaveBeenCalledWith([
      expect.objectContaining<Partial<SendMessageJob>>({
        invoiceId: 'invoice-1',
        message: expect.stringContaining('pix-copia-e-cola') as string,
      }),
    ]);
    expect(prisma.collectionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actionType: 'PAYMENT_GENERATED',
          status: 'PENDING',
        }),
      }),
    );
    expect(prisma.collectionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actionType: 'WHATSAPP_QUEUED',
          status: 'QUEUED',
        }),
      }),
    );
  });

  it('monta mensagem PIX com copia e cola e payment_link preenchido', async () => {
    const invoice = buildInvoice();
    const updatedInvoice = buildInvoice({
      gatewayId: 'tx-invoice-1',
      efiTxid: 'tx-invoice-1',
      pixPayload: 'pix-payload',
      efiPixCopiaECola: 'pix-copia-e-cola',
    });
    const { service, messageQueue } = createService({
      invoices: [invoice],
      updatedInvoice,
    });

    await service.executeBilling('company-1');

    const message = getQueuedMessage(messageQueue);
    expect(message).toContain('Forma de pagamento: PIX');
    expect(message).toContain('Acesse/pague por aqui: pix-copia-e-cola');
    expect(message).toContain('Pix copia e cola: pix-copia-e-cola');
    expect(message).not.toContain('Linha digitavel:');
    expect(message).not.toContain('{{');
  });

  it('monta mensagem boleto com link, linha digitavel e pdf quando existirem', async () => {
    const invoice = buildInvoice({
      billingType: 'BOLETO',
      gatewayId: 'charge-1',
      efiChargeId: 'charge-1',
      boletoLinhaDigitavel: '00190000000',
      boletoLink: 'https://boleto.example/12345',
      boletoPdf: 'https://boleto.example/12345.pdf',
    });
    const { service, messageQueue, createPayment } = createService({
      invoices: [invoice],
    });

    await service.executeBilling('company-1');

    const message = getQueuedMessage(messageQueue);
    expect(createPayment).not.toHaveBeenCalled();
    expect(message).toContain('Forma de pagamento: Boleto');
    expect(message).toContain(
      'Acesse/pague por aqui: https://boleto.example/12345',
    );
    expect(message).toContain('Linha digitavel: 00190000000');
    expect(message).toContain('Boleto: https://boleto.example/12345');
    expect(message).toContain(
      'PDF do boleto: https://boleto.example/12345.pdf',
    );
    expect(message).not.toContain('Pix copia e cola:');
    expect(message).not.toContain('{{');
  });

  it('monta mensagem Bolix com boleto e Pix quando a Efi retorna ambos', async () => {
    const invoice = buildInvoice({
      billingType: 'BOLIX',
      gatewayId: 'charge-1',
      efiChargeId: 'charge-1',
      boletoLinhaDigitavel: '23790000000',
      boletoLink: 'https://bolix.example/12345',
      boletoPdf: 'https://bolix.example/12345.pdf',
      efiPixCopiaECola: 'pix-bolix-copia-e-cola',
    });
    const { service, messageQueue } = createService({
      invoices: [invoice],
    });

    await service.executeBilling('company-1');

    const message = getQueuedMessage(messageQueue);
    expect(message).toContain('Forma de pagamento: Bolix');
    expect(message).toContain(
      'Acesse/pague por aqui: https://bolix.example/12345',
    );
    expect(message).toContain('Linha digitavel: 23790000000');
    expect(message).toContain('Pix copia e cola: pix-bolix-copia-e-cola');
    expect(message).not.toContain('{{');
  });

  it('usa fallback de payment_link quando boleto nao tem link', async () => {
    const invoice = buildInvoice({
      billingType: 'BOLETO',
      gatewayId: 'charge-1',
      efiChargeId: 'charge-1',
      boletoLinhaDigitavel: '34190000000',
    });
    const { service, messageQueue } = createService({
      invoices: [invoice],
    });

    await service.executeBilling('company-1');

    const message = getQueuedMessage(messageQueue);
    expect(message).toContain('Acesse/pague por aqui: 34190000000');
    expect(message).toContain('Linha digitavel: 34190000000');
    expect(message).not.toContain('Boleto:');
    expect(message).not.toContain('{{');
  });

  it('adiciona instrucao de pagamento quando o template nao traz variavel pagavel', async () => {
    const invoice = buildInvoice({
      gatewayId: 'tx-invoice-1',
      efiTxid: 'tx-invoice-1',
      efiPixCopiaECola: 'pix-copia-e-cola',
    });
    const { service, messageQueue } = createService({
      invoices: [invoice],
      templateContent: 'Ola {{nome_devedor}}, sua cobranca vence hoje.',
    });

    await service.executeBilling('company-1');

    const message = getQueuedMessage(messageQueue);
    expect(message).toContain('Ola Maria Silva, sua cobranca vence hoje.');
    expect(message).toContain('Forma de pagamento: PIX');
    expect(message).toContain('Acesse/pague por aqui: pix-copia-e-cola');
    expect(message).not.toContain('{{');
  });

  it('reutiliza pagamento existente sem gerar cobranca duplicada', async () => {
    const invoice = buildInvoice({
      billingType: 'BOLETO',
      gatewayId: '12345',
      efiChargeId: '12345',
      boletoLinhaDigitavel: '00190000000',
      boletoLink: 'https://boleto.example/12345',
    });
    const { service, messageQueue, createPayment, prisma } = createService({
      invoices: [invoice],
    });

    const result = await service.executeBilling('company-1');

    expect(result).toEqual({ queued: 1, skipped: 0 });
    expect(createPayment).not.toHaveBeenCalled();
    expect(messageQueue.addBulkSendMessageJobs).toHaveBeenCalledWith([
      expect.objectContaining<Partial<SendMessageJob>>({
        invoiceId: 'invoice-1',
        message: expect.stringContaining(
          'https://boleto.example/12345',
        ) as string,
      }),
    ]);
    expect(prisma.collectionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actionType: 'PAYMENT_REUSED',
        }),
      }),
    );
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
    expect(messageQueue.addBulkSendMessageJobs).not.toHaveBeenCalled();
    expect(prisma.collectionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actionType: 'PAYMENT_GENERATION_FAILED',
          status: 'FAILED',
          description: expect.stringContaining(
            'gateway indisponivel',
          ) as string,
        }),
      }),
    );
  });
});
