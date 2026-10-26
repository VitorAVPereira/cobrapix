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
  frequency: 'MONTHLY',
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
      frequency: 'MONTHLY',
      _count: { _all: 1200 },
      _sum: { amount: decimal(300000.5) },
    },
    {
      status: 'PAUSED',
      frequency: 'MONTHLY',
      _count: { _all: 34 },
      _sum: { amount: decimal(8000) },
    },
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
  it('counts a generated draft as the next invoice', async () => {
    const { service, findMany } = build();
    findMany.mockResolvedValueOnce([
      {
        ...recurrence,
        invoices: [
          {
            id: 'invoice-9',
            dueDate: new Date('2026-11-10T00:00:00.000Z'),
            originalAmount: decimal(250),
            status: 'DRAFT',
          },
        ],
      },
    ]);

    const result = await service.findRecurringPaginated('company-1', {
      page: 1,
      pageSize: 20,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          invoices: expect.objectContaining({
            where: {
              companyId: 'company-1',
              status: { in: ['DRAFT', 'PENDING'] },
            },
          }) as unknown,
        }) as unknown,
      }),
    );
    expect(result.data[0].pendingInvoice).toEqual({
      invoiceId: 'invoice-9',
      dueDate: '2026-11-10',
      amount: 250,
      status: 'DRAFT',
    });
  });

  it('activating one recurrence generates only that recurrence', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      recurringInvoice: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'recurrence-1',
            dueDay: 10,
            frequency: 'MONTHLY',
            status: 'PAUSED',
            nextDueDate: null,
          })
          .mockResolvedValueOnce(recurrence),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany,
      },
    } as unknown as PrismaService;
    const service = new InvoicesService(
      prisma,
      {} as MessageQueueService,
      {} as PaymentService,
    );

    await service.updateRecurringStatus('company-1', 'recurrence-1', 'ACTIVE');

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        companyId: 'company-1',
        id: 'recurrence-1',
        status: 'ACTIVE',
      }) as unknown,
    });
  });

  it('adds weekly and yearly recurrences to the summary by their amount per month', async () => {
    const { service, groupBy } = build();
    groupBy.mockResolvedValueOnce([
      {
        status: 'ACTIVE',
        frequency: 'MONTHLY',
        _count: { _all: 2 },
        _sum: { amount: decimal(200) },
      },
      {
        status: 'ACTIVE',
        frequency: 'WEEKLY',
        _count: { _all: 1 },
        _sum: { amount: decimal(60) },
      },
      {
        status: 'ACTIVE',
        frequency: 'YEARLY',
        _count: { _all: 1 },
        _sum: { amount: decimal(1200) },
      },
      {
        status: 'PAUSED',
        frequency: 'WEEKLY',
        _count: { _all: 3 },
        _sum: { amount: decimal(90) },
      },
    ]);

    const result = await service.findRecurringPaginated('company-1', {
      page: 1,
      pageSize: 20,
    });

    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['status', 'frequency'] }),
    );
    // 200 + 60 × 52 / 12 + 1200 / 12
    expect(result.summary).toEqual({
      active: 4,
      paused: 3,
      activeMonthlyAmount: 560,
    });
  });

  describe('schedule changes', () => {
    afterEach(() => jest.useRealTimers());

    function buildSchedule(current: Record<string, unknown>) {
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const prisma = {
        recurringInvoice: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce({ id: 'recurrence-1', ...current })
            .mockResolvedValueOnce(recurrence),
          updateMany,
          findMany: jest.fn().mockResolvedValue([]),
        },
      } as unknown as PrismaService;
      const service = new InvoicesService(
        prisma,
        {} as MessageQueueService,
        {} as PaymentService,
      );
      const nextDueDate = () =>
        (
          (updateMany.mock.calls as unknown[][])[0][0] as {
            data: { nextDueDate: Date | null; dueDay?: number };
          }
        ).data;
      return { service, nextDueDate };
    }

    it('reactivating does not charge the paused period', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-11T15:00:00Z'));
      const { service, nextDueDate } = buildSchedule({
        dueDay: 10,
        frequency: 'MONTHLY',
        status: 'PAUSED',
        nextDueDate: new Date('2026-01-10T12:00:00Z'),
      });

      await service.updateRecurringStatus(
        'company-1',
        'recurrence-1',
        'ACTIVE',
      );

      expect(nextDueDate().nextDueDate).toEqual(
        new Date('2026-06-10T12:00:00Z'),
      );
    });

    it('a weekly recurrence keeps its weekday when edited', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-23T15:00:00Z'));
      const { service, nextDueDate } = buildSchedule({
        dueDay: 26,
        frequency: 'WEEKLY',
        nextDueDate: new Date('2026-11-02T12:00:00Z'),
      });

      await service.updateRecurringInvoice('company-1', 'recurrence-1', {
        amount: 80,
        billingType: 'PIX',
        dueDay: 5,
      });

      expect(nextDueDate()).toEqual(
        expect.objectContaining({
          dueDay: 26,
          nextDueDate: new Date('2026-11-02T12:00:00Z'),
        }),
      );
    });

    it('a new day applies from the month of the next due date on', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-23T15:00:00Z'));
      const { service, nextDueDate } = buildSchedule({
        dueDay: 10,
        frequency: 'QUARTERLY',
        nextDueDate: new Date('2027-01-10T12:00:00Z'),
      });

      await service.updateRecurringInvoice('company-1', 'recurrence-1', {
        amount: 300,
        billingType: 'BOLIX',
        dueDay: 25,
      });

      expect(nextDueDate()).toEqual(
        expect.objectContaining({
          dueDay: 25,
          nextDueDate: new Date('2027-01-25T12:00:00Z'),
        }),
      );
    });

    it('a monthly day change does not create an invoice in the current month', async () => {
      // Created on 15/10 with day 10: November is generated, October never was.
      jest.useFakeTimers().setSystemTime(new Date('2026-10-23T15:00:00Z'));
      const { service, nextDueDate } = buildSchedule({
        dueDay: 10,
        frequency: 'MONTHLY',
        nextDueDate: new Date('2026-12-10T12:00:00Z'),
      });

      await service.updateRecurringInvoice('company-1', 'recurrence-1', {
        amount: 300,
        billingType: 'BOLIX',
        dueDay: 25,
      });

      expect(nextDueDate().nextDueDate).toEqual(
        new Date('2026-12-25T12:00:00Z'),
      );
    });
  });
});
