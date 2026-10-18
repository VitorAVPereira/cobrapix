import { Prisma } from '@prisma/client';
import { CompanyDashboardService } from './company-dashboard.service';

const money = (value: string) => new Prisma.Decimal(value);
// 18/10/2026 01:30 UTC is 17/10 22:30 in São Paulo.
const now = new Date('2026-10-18T01:30:00Z');

function setup() {
  const prisma = {
    invoice: {
      findMany: jest.fn(),
      groupBy: jest.fn().mockResolvedValue([]),
    },
  };
  const messagingLimit = {
    getInteractionStats: jest.fn().mockResolvedValue({
      outbound: 10,
      delivered: 9,
      read: 6,
      inbound: 2,
      failed: 1,
    }),
  };
  const email = {
    getStats: jest.fn().mockResolvedValue({
      periodStart: '',
      sent: 5,
      delivered: 4,
      opened: 3,
      clicked: 1,
      bounced: 0,
      complained: 0,
      failed: 0,
    }),
  };
  prisma.invoice.findMany.mockImplementation(
    ({ where }: { where: { status: string } }) =>
      Promise.resolve(
        where.status === 'PAID'
          ? [
              {
                originalAmount: money('100.10'),
                // 22:00 in São Paulo, still 15/10 there.
                paidAt: new Date('2026-10-16T01:00:00Z'),
                billingType: 'PIX',
                paymentCharges: [{ billingMethod: 'BOLIX' }],
              },
              {
                originalAmount: money('50.20'),
                paidAt: new Date('2026-10-17T15:00:00Z'),
                billingType: 'CREDIT_CARD',
                paymentCharges: [],
              },
            ]
          : [
              {
                originalAmount: money('30.00'),
                dueDate: new Date('2026-10-17T12:00:00Z'),
              },
              {
                originalAmount: money('20.00'),
                dueDate: new Date('2026-10-16T00:00:00Z'),
              },
              {
                originalAmount: money('40.00'),
                dueDate: new Date('2026-09-17T12:00:00Z'),
              },
              {
                originalAmount: money('10.00'),
                dueDate: new Date('2026-07-01T12:00:00Z'),
              },
            ],
      ),
  );
  const service = new CompanyDashboardService(
    prisma as never,
    messagingLimit as never,
    email as never,
  );
  return { service, prisma, messagingLimit, email };
}

describe('CompanyDashboardService', () => {
  it('reads only the signed-in company, with São Paulo day boundaries', async () => {
    const { service, prisma, messagingLimit, email } = setup();
    await service.get('company-a', '7d', {}, now);

    const window = {
      gte: new Date('2026-10-11T03:00:00Z'),
      lt: new Date('2026-10-18T03:00:00Z'),
    };
    const calls = [prisma.invoice.findMany, prisma.invoice.groupBy].flatMap(
      (mock) => mock.mock.calls as [{ where: { companyId: string } }][],
    );
    for (const [call] of calls) expect(call.where.companyId).toBe('company-a');
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'company-a', status: 'PAID', paidAt: window },
      }),
    );
    expect(messagingLimit.getInteractionStats).toHaveBeenCalledWith(
      'company-a',
      {
        start: window.gte,
        end: window.lt,
      },
    );
    expect(email.getStats).toHaveBeenCalledWith('company-a', {
      start: window.gte,
      end: window.lt,
    });
    // Due dates are calendar dates: compared from midnight UTC.
    expect(prisma.invoice.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'company-a',
          status: { in: ['PENDING', 'PAID'] },
          dueDate: {
            gte: new Date('2026-10-11T00:00:00Z'),
            lt: new Date('2026-10-18T00:00:00Z'),
          },
        },
      }),
    );
  });

  it('groups what was received by day and by payment method, BOLIX as boleto', async () => {
    const { service } = setup();
    const result = await service.get('company-a', '7d', {}, now);

    expect(result.received).toEqual({ amount: 150.3, count: 2 });
    expect(result.receivedSeries).toHaveLength(7);
    expect(result.receivedSeries).toContainEqual({
      date: '2026-10-15',
      amount: 100.1,
      count: 1,
    });
    expect(result.receivedSeries).toContainEqual({
      date: '2026-10-17',
      amount: 50.2,
      count: 1,
    });
    expect(result.receivedByMethod).toEqual([
      { method: 'PIX', amount: 0, count: 0 },
      { method: 'BOLETO', amount: 100.1, count: 1 },
      { method: 'CARD', amount: 50.2, count: 1 },
    ]);
  });

  it('splits the open portfolio into upcoming and overdue by days late', async () => {
    const { service } = setup();
    const result = await service.get('company-a', '30d', {}, now);

    // Due today (17/10 in São Paulo) is not overdue yet.
    expect(result.open).toEqual({
      amount: 100,
      count: 4,
      upcomingAmount: 30,
      upcomingCount: 1,
      overdueAmount: 70,
      overdueCount: 3,
    });
    expect(result.overdueAging).toEqual([
      { range: '1-15', amount: 20, count: 1 },
      { range: '16-30', amount: 40, count: 1 },
      { range: '31-60', amount: 0, count: 0 },
      { range: '60+', amount: 10, count: 1 },
    ]);
  });

  it('computes the collection rate of invoices due in the period, null without any', async () => {
    const { service, prisma } = setup();
    prisma.invoice.groupBy
      .mockResolvedValueOnce([
        { status: 'PENDING', _sum: { originalAmount: money('25.00') } },
        { status: 'PAID', _sum: { originalAmount: money('75.00') } },
      ])
      .mockResolvedValueOnce([]);
    const result = await service.get('company-a', '30d', {}, now);

    expect(result.collectionRate).toEqual({
      dueAmount: 100,
      paidAmount: 75,
      rate: 75,
      previousRate: null,
    });
    expect(result.whatsapp).toEqual({
      sent: 10,
      delivered: 9,
      read: 6,
      failed: 1,
      replies: 2,
    });
    expect(result.email).toEqual({
      sent: 5,
      delivered: 4,
      opened: 3,
      clicked: 1,
    });
  });

  it('groups by month on long periods', async () => {
    const { service } = setup();
    const result = await service.get('company-a', 'year', {}, now);

    expect(result.period.granularity).toBe('month');
    expect(result.receivedSeries.at(-1)).toEqual({
      date: '2026-10',
      amount: 150.3,
      count: 2,
    });
  });
});
