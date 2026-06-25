import { InvoicesService } from './invoices.service.ts';
import { PrismaService } from '../prisma/prisma.service';
import { MessageQueueService } from '../queue/message.queue';
import { PaymentService } from '../payment/payment.service';

function decimal(value: number): { toNumber(): number } {
  return { toNumber: () => value };
}

function buildInvoice(overrides: {
  id?: string;
  companyId?: string;
  debtorId?: string;
  dueDate?: Date;
  paidAt?: Date | null;
  status?: string;
  amount?: number;
  recurringInvoiceId?: string | null;
  recurrencePeriod?: string | null;
}) {
  const dueDate = overrides.dueDate ?? new Date('2026-04-30T12:00:00.000Z');

  return {
    id: overrides.id ?? 'invoice-1',
    companyId: overrides.companyId ?? 'company-1',
    debtorId: overrides.debtorId ?? 'debtor-1',
    debtor: {
      id: overrides.debtorId ?? 'debtor-1',
      name: 'Maria Silva',
      document: '12345678909',
      phoneNumber: '11999999999',
      email: 'maria@email.com',
      whatsappOptIn: false,
      collectionProfile: null,
    },
    originalAmount: decimal(overrides.amount ?? 199.9),
    dueDate,
    status: overrides.status ?? 'PENDING',
    gatewayId: null,
    pixPayload: null,
    pixExpiresAt: null,
    efiTxid: null,
    efiChargeId: null,
    efiPixCopiaECola: null,
    boletoLinhaDigitavel: null,
    boletoLink: null,
    boletoPdf: null,
    billingType: 'PIX',
    studentName: null,
    studentEnrollment: null,
    studentGroup: null,
    paidAt: overrides.paidAt ?? null,
    createdAt: new Date('2026-04-25T12:00:00.000Z'),
    updatedAt: new Date('2026-04-25T12:00:00.000Z'),
    recurringInvoiceId: overrides.recurringInvoiceId ?? null,
    recurrencePeriod: overrides.recurrencePeriod ?? null,
    recurringInvoice: overrides.recurringInvoiceId
      ? {
          dueDay: 31,
          status: 'ACTIVE',
        }
      : null,
  };
}

describe('InvoicesService', () => {
  function buildMessageQueue(): MessageQueueService {
    return {
      addInitialChargeJobs: jest.fn().mockResolvedValue(undefined),
    } as unknown as MessageQueueService;
  }

  function buildPaymentService(): PaymentService {
    return {
      cancelPaymentForInvoice: jest.fn().mockResolvedValue({
        providerAction: 'LOCAL_ONLY',
        gatewayStatusRaw: 'CANCELED_BY_USER',
      }),
    } as unknown as PaymentService;
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it('cria fatura avulsa para devedor existente respeitando companyId', async () => {
    const invoice = buildInvoice({});
    const transaction = jest.fn(
      async (
        callback: (tx: {
          debtor: { findFirst: jest.Mock };
          invoice: { create: jest.Mock };
        }) => Promise<unknown>,
      ) =>
        callback({
          debtor: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'debtor-1',
              document: '12345678909',
              name: 'Maria Silva',
            }),
          },
          invoice: {
            create: jest.fn().mockResolvedValue(invoice),
          },
        }),
    );
    const prisma = {
      company: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'company-1',
          enabledBillingMethods: ['PIX', 'BOLETO', 'BOLIX'],
        }),
      },
      $transaction: transaction,
    } as unknown as PrismaService;

    const service = new InvoicesService(
      prisma,
      buildMessageQueue(),
      buildPaymentService(),
    );
    const result = await service.createInvoice('company-1', {
      debtorId: 'debtor-1',
      original_amount: 199.9,
      due_date: '2026-05-10',
      billing_type: 'PIX',
    });

    expect(result.invoiceId).toBe('invoice-1');
    const tx = transaction.mock.calls[0]?.[0];
    expect(tx).toBeDefined();
  });

  it('cria devedor novo com documento normalizado na fatura manual', async () => {
    const invoice = buildInvoice({ debtorId: 'debtor-new' });
    const debtorFindMany = jest.fn().mockResolvedValue([]);
    const debtorCreate = jest.fn().mockResolvedValue({ id: 'debtor-new' });
    const invoiceCreate = jest.fn().mockResolvedValue(invoice);
    const prisma = {
      company: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'company-1',
          enabledBillingMethods: ['PIX', 'BOLETO', 'BOLIX'],
        }),
      },
      $transaction: jest.fn(
        async (
          callback: (tx: {
            debtor: {
              findMany: typeof debtorFindMany;
              create: typeof debtorCreate;
            };
            invoice: { create: typeof invoiceCreate };
          }) => Promise<unknown>,
        ) =>
          callback({
            debtor: { findMany: debtorFindMany, create: debtorCreate },
            invoice: { create: invoiceCreate },
          }),
      ),
    } as unknown as PrismaService;

    const service = new InvoicesService(
      prisma,
      buildMessageQueue(),
      buildPaymentService(),
    );
    const result = await service.createInvoice('company-1', {
      name: 'Maria Silva',
      document: '123.456.789-09',
      phone_number: '11999999999',
      email: 'maria@email.com',
      original_amount: 199.9,
      due_date: '2026-05-10',
      billing_type: 'PIX',
    });

    expect(result.phone_number).toBe('+5511999999999');
    expect(debtorCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'company-1',
          document: '12345678909',
          phoneNumber: '+5511999999999',
        }) as unknown,
      }),
    );
    expect(invoiceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'company-1',
          debtorId: 'debtor-new',
        }) as unknown,
      }),
    );
  });

  it('bloqueia fatura manual para novo devedor sem CPF ou CNPJ', async () => {
    const transaction = jest.fn();
    const prisma = {
      company: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'company-1',
          enabledBillingMethods: ['PIX', 'BOLETO', 'BOLIX'],
        }),
      },
      $transaction: transaction,
    } as unknown as PrismaService;

    const service = new InvoicesService(
      prisma,
      buildMessageQueue(),
      buildPaymentService(),
    );

    await expect(
      service.createInvoice('company-1', {
        name: 'Maria Silva',
        phone_number: '11999999999',
        email: 'maria@email.com',
        original_amount: 199.9,
        due_date: '2026-05-10',
        billing_type: 'PIX',
      }),
    ).rejects.toThrow('CPF/CNPJ do devedor');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('bloqueia nova fatura para devedor existente sem CPF ou CNPJ salvo', async () => {
    const transaction = jest.fn(
      async (
        callback: (tx: {
          debtor: { findFirst: jest.Mock };
          invoice: { create: jest.Mock };
        }) => Promise<unknown>,
      ) =>
        callback({
          debtor: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'debtor-1',
              document: null,
            }),
          },
          invoice: {
            create: jest.fn(),
          },
        }),
    );
    const prisma = {
      company: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'company-1',
          enabledBillingMethods: ['PIX', 'BOLETO', 'BOLIX'],
        }),
      },
      $transaction: transaction,
    } as unknown as PrismaService;

    const service = new InvoicesService(
      prisma,
      buildMessageQueue(),
      buildPaymentService(),
    );

    await expect(
      service.createInvoice('company-1', {
        debtorId: 'debtor-1',
        original_amount: 199.9,
        due_date: '2026-05-10',
        billing_type: 'PIX',
      }),
    ).rejects.toThrow('CPF/CNPJ do devedor');
  });

  it('bloqueia criacao de fatura com metodo nao habilitado para a empresa', async () => {
    const transaction = jest.fn();
    const prisma = {
      company: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'company-1',
          enabledBillingMethods: ['PIX'],
        }),
      },
      $transaction: transaction,
    } as unknown as PrismaService;

    const service = new InvoicesService(
      prisma,
      buildMessageQueue(),
      buildPaymentService(),
    );

    await expect(
      service.createInvoice('company-1', {
        name: 'Maria Silva',
        document: '123.456.789-09',
        phone_number: '11999999999',
        email: 'maria@email.com',
        original_amount: 199.9,
        due_date: '2026-05-10',
        billing_type: 'BOLETO',
      }),
    ).rejects.toThrow('Metodo de cobranca nao habilitado');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('enfileira primeira cobranca apos importacao CSV', async () => {
    const debtorFindMany = jest.fn().mockResolvedValue([]);
    const debtorCreate = jest.fn().mockResolvedValue({ id: 'debtor-1' });
    const invoiceCreate = jest.fn().mockResolvedValue({ id: 'invoice-1' });
    const messageQueue = {
      addInitialChargeJobs: jest.fn().mockResolvedValue(undefined),
    } as unknown as MessageQueueService;
    const prisma = {
      $transaction: jest.fn(
        async (
          callback: (tx: {
            debtor: {
              findMany: typeof debtorFindMany;
              create: typeof debtorCreate;
            };
            invoice: { create: typeof invoiceCreate };
          }) => Promise<unknown>,
        ) =>
          callback({
            debtor: { findMany: debtorFindMany, create: debtorCreate },
            invoice: { create: invoiceCreate },
          }),
      ),
    } as unknown as PrismaService;

    const service = new InvoicesService(
      prisma,
      messageQueue,
      buildPaymentService(),
    );
    const result = await service.importCsv('company-1', [
      {
        name: 'Maria Silva',
        document: '123.456.789-09',
        phone_number: '11999999999',
        email: 'maria@email.com',
        original_amount: 199.9,
        due_date: '2026-05-10',
        billing_type: 'PIX',
      },
    ]);

    expect(result).toEqual({
      success: true,
      count: 1,
      initialChargeQueued: 1,
    });
    expect(debtorCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          document: '12345678909',
          phoneNumber: '+5511999999999',
        }) as unknown,
      }),
    );
    const messageQueueMock = messageQueue as unknown as {
      addInitialChargeJobs: jest.Mock;
    };
    const { addInitialChargeJobs } = messageQueueMock;
    expect(addInitialChargeJobs).toHaveBeenCalledWith([
      {
        invoiceId: 'invoice-1',
        companyId: 'company-1',
        source: 'CSV',
      },
    ]);
  });

  it('cancela fatura pendente local sem identificadores Efi', async () => {
    const invoice = buildInvoice({ id: 'invoice-1', status: 'PENDING' });
    const canceledInvoice = buildInvoice({
      id: 'invoice-1',
      status: 'CANCELED',
    });
    const invoiceFindFirst = jest
      .fn()
      .mockResolvedValueOnce(invoice)
      .mockResolvedValueOnce(canceledInvoice);
    const invoiceUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const collectionLogCreate = jest.fn().mockResolvedValue({ id: 'log-1' });
    const transaction = jest.fn(
      async (
        callback: (tx: {
          invoice: {
            updateMany: typeof invoiceUpdateMany;
            findFirst: typeof invoiceFindFirst;
          };
          collectionLog: { create: typeof collectionLogCreate };
        }) => Promise<unknown>,
      ) =>
        callback({
          invoice: {
            updateMany: invoiceUpdateMany,
            findFirst: invoiceFindFirst,
          },
          collectionLog: { create: collectionLogCreate },
        }),
    );
    const prisma = {
      invoice: {
        findFirst: invoiceFindFirst,
      },
      $transaction: transaction,
    } as unknown as PrismaService;
    const paymentService = buildPaymentService();
    const paymentServiceMock = paymentService as unknown as {
      cancelPaymentForInvoice: jest.Mock;
    };

    const service = new InvoicesService(
      prisma,
      buildMessageQueue(),
      paymentService,
    );
    const result = await service.cancelInvoice('company-1', 'invoice-1');

    expect(paymentServiceMock.cancelPaymentForInvoice).toHaveBeenCalledWith({
      id: 'invoice-1',
      companyId: 'company-1',
      efiTxid: null,
      efiChargeId: null,
    });
    expect(invoiceUpdateMany).toHaveBeenCalledWith({
      where: { id: 'invoice-1', companyId: 'company-1', status: 'PENDING' },
      data: {
        status: 'CANCELED',
        gatewayStatusRaw: 'CANCELED_BY_USER',
      },
    });
    expect(collectionLogCreate).toHaveBeenCalledWith({
      data: {
        companyId: 'company-1',
        invoiceId: 'invoice-1',
        actionType: 'INVOICE_CANCELED',
        description: 'Fatura cancelada pelo usuario.',
        status: 'CANCELED',
      },
    });
    expect(result.status).toBe('CANCELED');
  });

  it('mantem fatura pendente quando cancelamento Efi falha', async () => {
    const invoice = buildInvoice({
      id: 'invoice-1',
      status: 'PENDING',
    });
    const transaction = jest.fn();
    const prisma = {
      invoice: {
        findFirst: jest.fn().mockResolvedValue(invoice),
      },
      $transaction: transaction,
    } as unknown as PrismaService;
    const paymentService = buildPaymentService();
    const paymentServiceMock = paymentService as unknown as {
      cancelPaymentForInvoice: jest.Mock;
    };
    paymentServiceMock.cancelPaymentForInvoice.mockRejectedValue(
      new Error('Efi indisponivel'),
    );

    const service = new InvoicesService(
      prisma,
      buildMessageQueue(),
      paymentService,
    );

    await expect(
      service.cancelInvoice('company-1', 'invoice-1'),
    ).rejects.toThrow('Efi indisponivel');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejeita cancelamento de fatura paga sem chamar PaymentService', async () => {
    const invoice = buildInvoice({ id: 'invoice-1', status: 'PAID' });
    const prisma = {
      invoice: {
        findFirst: jest.fn().mockResolvedValue(invoice),
      },
      $transaction: jest.fn(),
    } as unknown as PrismaService;
    const paymentService = buildPaymentService();
    const paymentServiceMock = paymentService as unknown as {
      cancelPaymentForInvoice: jest.Mock;
    };

    const service = new InvoicesService(
      prisma,
      buildMessageQueue(),
      paymentService,
    );

    await expect(
      service.cancelInvoice('company-1', 'invoice-1'),
    ).rejects.toThrow('Apenas faturas pendentes podem ser canceladas.');
    expect(paymentServiceMock.cancelPaymentForInvoice).not.toHaveBeenCalled();
  });

  it('retorna erro quando fatura para cancelamento nao existe', async () => {
    const prisma = {
      invoice: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(),
    } as unknown as PrismaService;
    const paymentService = buildPaymentService();
    const paymentServiceMock = paymentService as unknown as {
      cancelPaymentForInvoice: jest.Mock;
    };

    const service = new InvoicesService(
      prisma,
      buildMessageQueue(),
      paymentService,
    );

    await expect(
      service.cancelInvoice('company-1', 'invoice-1'),
    ).rejects.toThrow('Fatura nao encontrada.');
    expect(paymentServiceMock.cancelPaymentForInvoice).not.toHaveBeenCalled();
  });

  it('monta historico de pagamentos do devedor com pontualidade', async () => {
    const paidEarly = buildInvoice({
      id: 'invoice-early',
      amount: 100,
      dueDate: new Date('2026-05-10T12:00:00.000Z'),
      paidAt: new Date('2026-05-08T15:00:00.000Z'),
      status: 'PAID',
    });
    const paidOnDueDate = buildInvoice({
      id: 'invoice-on-due-date',
      amount: 150,
      dueDate: new Date('2026-05-10T12:00:00.000Z'),
      paidAt: new Date('2026-05-10T20:00:00.000Z'),
      status: 'PAID',
    });
    const paidOverdue = buildInvoice({
      id: 'invoice-overdue',
      amount: 200,
      dueDate: new Date('2026-05-10T12:00:00.000Z'),
      paidAt: new Date('2026-05-13T14:00:00.000Z'),
      status: 'PAID',
    });
    const debtorFindFirst = jest.fn().mockResolvedValue({
      id: 'debtor-1',
      name: 'Maria Silva',
      phoneNumber: '11999999999',
      email: 'maria@email.com',
      invoices: [paidOverdue, paidOnDueDate, paidEarly],
    });
    const prisma = {
      debtor: {
        findFirst: debtorFindFirst,
      },
    } as unknown as PrismaService;

    const service = new InvoicesService(
      prisma,
      buildMessageQueue(),
      buildPaymentService(),
    );
    const result = await service.getDebtorPaymentHistory(
      'company-1',
      'debtor-1',
    );

    expect(debtorFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'debtor-1', companyId: 'company-1' },
        select: expect.objectContaining({
          invoices: expect.objectContaining({
            where: { companyId: 'company-1', status: 'PAID' },
          }) as unknown,
        }) as unknown,
      }),
    );
    expect(result?.summary).toEqual({
      totalPaidInvoices: 3,
      totalPaidAmount: 450,
      paidOnOrBeforeDueDate: 2,
      paidEarly: 1,
      paidOnDueDate: 1,
      paidOverdue: 1,
      unknownTiming: 0,
      averageDaysAfterDue: 3,
      maxDaysAfterDue: 3,
      lastPaymentAt: '2026-05-13T14:00:00.000Z',
    });
    expect(result?.payments).toEqual([
      expect.objectContaining({
        invoiceId: 'invoice-overdue',
        timeliness: 'OVERDUE',
        paidOnOrBeforeDueDate: false,
        daysAfterDue: 3,
      }),
      expect.objectContaining({
        invoiceId: 'invoice-on-due-date',
        timeliness: 'ON_DUE_DATE',
        paidOnOrBeforeDueDate: true,
        daysAfterDue: 0,
      }),
      expect.objectContaining({
        invoiceId: 'invoice-early',
        timeliness: 'EARLY',
        paidOnOrBeforeDueDate: true,
        daysBeforeDue: 2,
      }),
    ]);
  });

  it('gera a primeira fatura recorrente no ultimo dia do mes quando dia 31 nao existe', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-25T12:00:00.000Z'));

    const recurrence = {
      id: 'recurrence-1',
      companyId: 'company-1',
      debtorId: 'debtor-1',
      amount: decimal(199.9),
      billingType: 'PIX',
      dueDay: 31,
      status: 'ACTIVE',
      nextDueDate: new Date('2026-04-30T12:00:00.000Z'),
      lastGeneratedPeriod: null,
      createdAt: new Date('2026-04-25T12:00:00.000Z'),
      updatedAt: new Date('2026-04-25T12:00:00.000Z'),
    };
    const invoice = buildInvoice({
      dueDate: new Date('2026-04-30T12:00:00.000Z'),
      recurringInvoiceId: 'recurrence-1',
      recurrencePeriod: '2026-04',
    });
    const invoiceUpsert = jest.fn().mockResolvedValue(invoice);
    const prisma = {
      company: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'company-1',
          enabledBillingMethods: ['PIX', 'BOLETO', 'BOLIX'],
        }),
      },
      debtor: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'debtor-1',
          document: '12345678909',
        }),
      },
      recurringInvoice: {
        create: jest.fn().mockResolvedValue(recurrence),
        findMany: jest.fn().mockResolvedValue([recurrence]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue({
          ...recurrence,
          lastGeneratedPeriod: '2026-04',
          nextDueDate: new Date('2026-05-31T12:00:00.000Z'),
          debtor: {
            id: 'debtor-1',
            name: 'Maria Silva',
            document: '12345678909',
            phoneNumber: '11999999999',
            email: 'maria@email.com',
          },
          invoices: [invoice],
        }),
      },
      invoice: {
        upsert: invoiceUpsert,
        findFirst: jest.fn().mockResolvedValue(invoice),
      },
    } as unknown as PrismaService;

    const service = new InvoicesService(
      prisma,
      buildMessageQueue(),
      buildPaymentService(),
    );
    const result = await service.createInvoice('company-1', {
      debtorId: 'debtor-1',
      original_amount: 199.9,
      billing_type: 'PIX',
      recurring: true,
      due_day: 31,
    });

    expect(result.due_date).toBe('2026-04-30');
    expect(invoiceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          recurringInvoiceId_recurrencePeriod: {
            recurringInvoiceId: 'recurrence-1',
            recurrencePeriod: '2026-04',
          },
        },
        create: expect.objectContaining({
          companyId: 'company-1',
          dueDate: new Date('2026-04-30T12:00:00.000Z'),
          recurrencePeriod: '2026-04',
        }) as unknown,
      }),
    );
  });

  describe('clientes pagadores', () => {
    const defaultProfile = {
      id: 'profile-new',
      name: 'Novo Cliente',
      profileType: 'NEW',
    };

    function buildDebtor(
      overrides: Partial<{
        id: string;
        name: string;
        document: string;
        phoneNumber: string;
        email: string | null;
        collectionProfileId: string | null;
      }> = {},
    ) {
      return {
        id: overrides.id ?? 'debtor-1',
        companyId: 'company-1',
        name: overrides.name ?? 'Maria Silva',
        document: overrides.document ?? '12345678909',
        phoneNumber: overrides.phoneNumber ?? '+5511999999999',
        email: overrides.email ?? null,
        whatsappOptIn: false,
        whatsappOptInAt: null,
        whatsappOptInSource: null,
        collectionProfileId:
          overrides.collectionProfileId === undefined
            ? defaultProfile.id
            : overrides.collectionProfileId,
        collectionProfile:
          overrides.collectionProfileId === null ? null : defaultProfile,
        createdAt: new Date('2026-06-01T12:00:00.000Z'),
        updatedAt: new Date('2026-06-02T12:00:00.000Z'),
        invoices: [],
      };
    }

    it('cria cliente sem cobranca com perfil NEW quando nenhum perfil e enviado', async () => {
      const debtorCreate = jest.fn().mockResolvedValue(buildDebtor());
      const profileFindFirst = jest.fn().mockResolvedValue(defaultProfile);
      const prisma = {
        collectionProfile: { findFirst: profileFindFirst },
        debtor: {
          findMany: jest.fn().mockResolvedValue([]),
          create: debtorCreate,
        },
      } as unknown as PrismaService;
      const service = new InvoicesService(
        prisma,
        buildMessageQueue(),
        buildPaymentService(),
      );

      const result = await service.createDebtor('company-1', {
        name: 'Maria Silva',
        document: '123.456.789-09',
        phone_number: '11999999999',
        email: null,
        whatsappOptIn: false,
      });

      expect(profileFindFirst).toHaveBeenCalledWith({
        where: { companyId: 'company-1', profileType: 'NEW', isActive: true },
        select: { id: true, name: true, profileType: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });
      expect(debtorCreate).toHaveBeenCalledWith({
        data: {
          companyId: 'company-1',
          name: 'Maria Silva',
          document: '12345678909',
          phoneNumber: '+5511999999999',
          email: null,
          whatsappOptIn: false,
          whatsappOptInAt: null,
          whatsappOptInSource: null,
          collectionProfileId: 'profile-new',
        },
        include: { collectionProfile: true },
      });
      expect(result.collectionProfile.profileType).toBe('NEW');
      expect(result.openInvoicesCount).toBe(0);
      expect(result.paidInvoicesCount).toBe(0);
    });

    it('rejeita cliente novo com WhatsApp duplicado na empresa', async () => {
      const prisma = {
        collectionProfile: {
          findFirst: jest.fn().mockResolvedValue(defaultProfile),
        },
        debtor: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              { id: 'existing', phoneNumber: '+5511999999999' },
            ]),
        },
      } as unknown as PrismaService;
      const service = new InvoicesService(
        prisma,
        buildMessageQueue(),
        buildPaymentService(),
      );

      await expect(
        service.createDebtor('company-1', {
          name: 'Maria Silva',
          document: '12345678909',
          phone_number: '11999999999',
          email: null,
          whatsappOptIn: false,
        }),
      ).rejects.toThrow('Ja existe cliente com este WhatsApp.');
    });

    it('lista clientes com totais de cobrancas e backfill de perfil NEW', async () => {
      const debtorWithInvoices = {
        ...buildDebtor(),
        invoices: [
          {
            status: 'PENDING',
            originalAmount: decimal(120),
            createdAt: new Date('2026-06-04T12:00:00.000Z'),
            paidAt: null,
          },
          {
            status: 'PAID',
            originalAmount: decimal(80),
            createdAt: new Date('2026-06-01T12:00:00.000Z'),
            paidAt: new Date('2026-06-03T12:00:00.000Z'),
          },
        ],
      };
      const debtorFindMany = jest.fn().mockResolvedValue([debtorWithInvoices]);
      const debtorUpdateMany = jest.fn().mockResolvedValue({ count: 2 });
      const prisma = {
        collectionProfile: {
          findFirst: jest.fn().mockResolvedValue(defaultProfile),
        },
        debtor: {
          updateMany: debtorUpdateMany,
          findMany: debtorFindMany,
          count: jest.fn().mockResolvedValue(1),
        },
      } as unknown as PrismaService;
      const service = new InvoicesService(
        prisma,
        buildMessageQueue(),
        buildPaymentService(),
      );

      const result = await service.listDebtors('company-1', {
        page: 1,
        pageSize: 20,
        search: 'maria',
      });

      expect(debtorUpdateMany).toHaveBeenCalledWith({
        where: { companyId: 'company-1', collectionProfileId: null },
        data: { collectionProfileId: 'profile-new' },
      });
      expect(debtorFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ companyId: 'company-1' }) as unknown,
          include: expect.objectContaining({
            collectionProfile: true,
            invoices: expect.objectContaining({
              where: expect.objectContaining({
                companyId: 'company-1',
                status: { in: ['PENDING', 'PAID'] },
              }) as unknown,
            }) as unknown,
          }) as unknown,
        }),
      );
      expect(result.summary).toEqual({
        totalDebtors: 1,
        openInvoiceAmount: 120,
        openInvoiceCount: 1,
        paidInvoiceAmount: 80,
        paidInvoiceCount: 1,
      });
      expect(result.data[0]).toEqual(
        expect.objectContaining({
          debtorId: 'debtor-1',
          openInvoicesCount: 1,
          openInvoicesAmount: 120,
          paidInvoicesCount: 1,
          paidInvoicesAmount: 80,
          collectionProfile: defaultProfile,
        }),
      );
    });

    it('calcula resumo de todos os clientes filtrados mesmo quando pagina retorna menos itens', async () => {
      const pageDebtor = {
        ...buildDebtor({ id: 'debtor-page' }),
        invoices: [
          {
            status: 'PENDING',
            originalAmount: decimal(120),
            createdAt: new Date('2026-06-04T12:00:00.000Z'),
            paidAt: null,
          },
        ],
      };
      const summaryDebtor = {
        ...buildDebtor({ id: 'debtor-summary' }),
        invoices: [
          {
            status: 'PENDING',
            originalAmount: decimal(50),
            createdAt: new Date('2026-06-05T12:00:00.000Z'),
            paidAt: null,
          },
          {
            status: 'PAID',
            originalAmount: decimal(200),
            createdAt: new Date('2026-06-02T12:00:00.000Z'),
            paidAt: new Date('2026-06-03T12:00:00.000Z'),
          },
        ],
      };
      const debtorFindMany = jest
        .fn()
        .mockResolvedValueOnce([pageDebtor])
        .mockResolvedValueOnce([pageDebtor, summaryDebtor]);
      const prisma = {
        collectionProfile: {
          findFirst: jest.fn().mockResolvedValue(defaultProfile),
        },
        debtor: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          findMany: debtorFindMany,
          count: jest.fn().mockResolvedValue(2),
        },
      } as unknown as PrismaService;
      const service = new InvoicesService(
        prisma,
        buildMessageQueue(),
        buildPaymentService(),
      );

      const result = await service.listDebtors('company-1', {
        page: 1,
        pageSize: 1,
        search: 'maria',
      });

      expect(debtorFindMany).toHaveBeenCalledTimes(2);
      expect(debtorFindMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          skip: 0,
          take: 1,
          where: expect.objectContaining({ companyId: 'company-1' }) as unknown,
        }),
      );
      expect(debtorFindMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          skip: undefined,
          take: undefined,
          where: expect.objectContaining({ companyId: 'company-1' }) as unknown,
        }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.summary).toEqual({
        totalDebtors: 2,
        openInvoiceAmount: 170,
        openInvoiceCount: 2,
        paidInvoiceAmount: 200,
        paidInvoiceCount: 1,
      });
    });

    it('edita cliente e rejeita remocao de perfil', async () => {
      const debtorFindFirst = jest
        .fn()
        .mockResolvedValueOnce({ id: 'debtor-1', whatsappOptInAt: null })
        .mockResolvedValueOnce(
          buildDebtor({ name: 'Maria Editada', email: 'maria@email.com' }),
        );
      const debtorUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      const prisma = {
        collectionProfile: {
          findFirst: jest.fn().mockResolvedValue(defaultProfile),
        },
        debtor: {
          findFirst: debtorFindFirst,
          findMany: jest.fn().mockResolvedValue([]),
          updateMany: debtorUpdateMany,
        },
      } as unknown as PrismaService;
      const service = new InvoicesService(
        prisma,
        buildMessageQueue(),
        buildPaymentService(),
      );

      const result = await service.updateDebtor('company-1', 'debtor-1', {
        name: 'Maria Editada',
        document: '123.456.789-09',
        phone_number: '+55 11 99999-9999',
        email: 'maria@email.com',
        collectionProfileId: 'profile-new',
      });

      expect(result?.name).toBe('Maria Editada');
      expect(debtorUpdateMany).toHaveBeenCalledWith({
        where: { id: 'debtor-1', companyId: 'company-1' },
        data: expect.objectContaining({
          name: 'Maria Editada',
          document: '12345678909',
          phoneNumber: '+5511999999999',
          email: 'maria@email.com',
          collectionProfileId: 'profile-new',
        }) as unknown,
      });

      await expect(
        service.updateDebtor('company-1', 'debtor-1', {
          collectionProfileId: null as unknown as string,
        }),
      ).rejects.toThrow('Perfil de pagador e obrigatorio.');
    });
  });
});
