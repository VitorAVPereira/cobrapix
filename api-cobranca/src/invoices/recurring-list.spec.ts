import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import type { MessageQueueService } from '../queue/message.queue';
import type { PaymentService } from '../payment/payment.service';
import type { PrismaService } from '../prisma/prisma.service';

function decimal(value: number): { toNumber(): number } {
  return { toNumber: () => value };
}

const recurrence = {
  id: 'recurrence-1',
  companyId: 'company-1',
  amount: decimal(250),
  billingType: 'BOLIX',
  dueDay: 10,
  status: 'ACTIVE',
  nextDueDate: new Date('2026-11-10T00:00:00.000Z'),
  lastGeneratedPeriod: '2026-10',
  lateFineBasisPoints: null,
  lateInterestMonthlyBasisPoints: null,
  paymentDaysAfterDue: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  debtor: {
    id: 'debtor-1',
    name: 'Ana Souza',
    document: '52998224725',
    phoneNumber: '5511999990001',
    email: null,
  },
  invoices: [],
};

function build() {
  const findMany = jest.fn().mockResolvedValue([recurrence]);
  const count = jest.fn().mockResolvedValue(1234);
  const groupBy = jest.fn().mockResolvedValue([
    {
      status: 'ACTIVE',
      _count: { _all: 1200 },
      _sum: { amount: decimal(300000.5) },
    },
    { status: 'PAUSED', _count: { _all: 34 }, _sum: { amount: decimal(8000) } },
  ]);
  const prisma = {
    recurringInvoice: { findMany, count, groupBy },
  } as unknown as PrismaService;
  const service = new InvoicesService(
    prisma,
    {} as MessageQueueService,
    {} as PaymentService,
  );
  return { service, findMany, count, groupBy };
}

describe('recurring invoices list', () => {
  it('pages the company recurrences with a company-wide summary', async () => {
    const { service, findMany, groupBy } = build();

    const result = await service.findRecurringPaginated('company-1', {
      page: 3,
      pageSize: 50,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'company-1' },
        orderBy: [
          { status: 'asc' },
          { debtor: { name: 'asc' } },
          { id: 'asc' },
        ],
        skip: 100,
        take: 50,
      }),
    );
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'company-1' } }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        total: 1234,
        page: 3,
        pageSize: 50,
        summary: { active: 1200, paused: 34, activeMonthlyAmount: 300000.5 },
      }),
    );
    expect(result.data[0]).toEqual(
      expect.objectContaining({ recurrenceId: 'recurrence-1', amount: 250 }),
    );
  });

  it('filters by status, boleto (with BOLIX) and a punctuated document', async () => {
    const { service, findMany } = build();

    await service.findRecurringPaginated('company-1', {
      page: 1,
      pageSize: 20,
      status: 'PAUSED',
      billingType: 'BOLETO',
      search: '529.982.247-25',
    });

    const { where } = (findMany.mock.calls as unknown[][])[0][0] as {
      where: Record<string, unknown>;
    };
    expect(where).toEqual({
      companyId: 'company-1',
      status: 'PAUSED',
      billingType: { in: ['BOLETO', 'BOLIX'] },
      debtor: {
        OR: expect.arrayContaining([
          { document: { contains: '52998224725' } },
          { phoneNumber: { contains: '52998224725' } },
        ]) as unknown,
      },
    });
  });

  it('keeps the old array for a request without page', async () => {
    const service = {
      listRecurringInvoices: jest.fn().mockResolvedValue([]),
      findRecurringPaginated: jest.fn(),
    };
    const controller = new InvoicesController(
      service as unknown as InvoicesService,
    );
    const user = { companyId: 'company-1' } as never;

    await controller.listRecurringInvoices(user, {});
    expect(service.listRecurringInvoices).toHaveBeenCalledWith('company-1');

    await controller.listRecurringInvoices(user, { page: 2, status: 'ACTIVE' });
    expect(service.findRecurringPaginated).toHaveBeenCalledWith('company-1', {
      page: 2,
      pageSize: 20,
      status: 'ACTIVE',
    });
  });
});
