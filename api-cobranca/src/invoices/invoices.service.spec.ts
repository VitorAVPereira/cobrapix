import { InvoicesService } from './invoices.service.ts';
import { PrismaService } from '../prisma/prisma.service';

function decimal(value: number): { toNumber(): number } {
  return { toNumber: () => value };
}

function buildInvoice(overrides: {
  id?: string;
  companyId?: string;
  debtorId?: string;
  dueDate?: Date;
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
    },
    originalAmount: decimal(199.9),
    dueDate,
    status: 'PENDING',
    gatewayId: null,
    pixPayload: null,
    billingType: 'PIX',
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
  afterEach(() => {
    jest.useRealTimers();
  });

  it('cria fatura avulsa para devedor existente respeitando companyId', async () => {
    const invoice = buildInvoice({});
    const transaction = jest.fn(async (callback: (tx: {
      debtor: { findFirst: jest.Mock };
      invoice: { create: jest.Mock };
    }) => Promise<unknown>) =>
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

    const service = new InvoicesService(prisma);
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
    const debtorUpsert = jest.fn().mockResolvedValue({ id: 'debtor-new' });
    const invoiceCreate = jest.fn().mockResolvedValue(invoice);
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: {
        debtor: { upsert: typeof debtorUpsert };
        invoice: { create: typeof invoiceCreate };
      }) => Promise<unknown>) =>
        callback({
          debtor: { upsert: debtorUpsert },
          invoice: { create: invoiceCreate },
        }),
      ),
    } as unknown as PrismaService;

    const service = new InvoicesService(prisma);
    await service.createInvoice('company-1', {
      name: 'Maria Silva',
      phone_number: '11999999999',
      email: 'maria@email.com',
      original_amount: 199.9,
      due_date: '2026-05-10',
      billing_type: 'PIX',
    });

    expect(debtorUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId_phoneNumber: {
            companyId: 'company-1',
            phoneNumber: '11999999999',
          },
        },
      }),
    );
    expect(invoiceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'company-1',
          debtorId: 'debtor-new',
        }),
      }),
    );
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

    const service = new InvoicesService(prisma);
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
        }),
      }),
    );
  });
});
