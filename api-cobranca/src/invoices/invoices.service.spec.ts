import { InvoicesService } from './invoices.service.ts';
import { PrismaService } from '../prisma/prisma.service';
import { MessageQueueService } from '../queue/message.queue';

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
              name: 'Maria Silva',
            }),
          },
          invoice: {
            create: jest.fn().mockResolvedValue(invoice),
          },
        }),
    );
    const prisma = {
      $transaction: transaction,
    } as unknown as PrismaService;

    const service = new InvoicesService(prisma, buildMessageQueue());
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

  it('cria devedor novo com fatura manual', async () => {
    const invoice = buildInvoice({ debtorId: 'debtor-new' });
    const debtorFindMany = jest.fn().mockResolvedValue([]);
    const debtorCreate = jest.fn().mockResolvedValue({ id: 'debtor-new' });
    const invoiceCreate = jest.fn().mockResolvedValue(invoice);
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

    const service = new InvoicesService(prisma, buildMessageQueue());
    const result = await service.createInvoice('company-1', {
      name: 'Maria Silva',
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

    const service = new InvoicesService(prisma, messageQueue);
    const result = await service.importCsv('company-1', [
      {
        name: 'Maria Silva',
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
          phoneNumber: '+5511999999999',
        }) as unknown,
      }),
    );
    expect(messageQueue.addInitialChargeJobs).toHaveBeenCalledWith([
      {
        invoiceId: 'invoice-1',
        companyId: 'company-1',
        source: 'CSV',
      },
    ]);
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

    const service = new InvoicesService(prisma, buildMessageQueue());
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
      debtor: {
        findFirst: jest.fn().mockResolvedValue({ id: 'debtor-1' }),
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

    const service = new InvoicesService(prisma, buildMessageQueue());
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
});
