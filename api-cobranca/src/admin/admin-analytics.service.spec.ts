import { CollectionAttemptStatus, InvoiceStatus } from '@prisma/client';
import { AdminAnalyticsService } from './admin-analytics.service';
import { PrismaService } from '../prisma/prisma.service';

type PrismaMock = {
  company: {
    count: jest.Mock;
    findMany: jest.Mock;
  };
  invoice: {
    findMany: jest.Mock;
  };
  collectionAttempt: {
    findMany: jest.Mock;
  };
};

function createPrismaMock(): PrismaMock {
  return {
    company: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    invoice: {
      findMany: jest.fn(),
    },
    collectionAttempt: {
      findMany: jest.fn(),
    },
  };
}

describe('AdminAnalyticsService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(
      new Date('2026-06-23T12:00:00.000Z'),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('calcula metricas macro e por cliente para o mes atual', async () => {
    const prisma = createPrismaMock();
    prisma.company.count.mockResolvedValue(2);
    prisma.company.findMany.mockResolvedValue([
      {
        id: 'company-1',
        corporateName: 'Alpha Escola',
        document: '11111111000191',
        email: 'alpha@example.com',
        status: 'ACTIVE',
      },
      {
        id: 'company-2',
        corporateName: 'Beta Curso',
        document: '22222222000192',
        email: 'beta@example.com',
        status: 'ACTIVE',
      },
    ]);
    prisma.invoice.findMany.mockResolvedValueOnce([
      {
        id: 'invoice-1',
        companyId: 'company-1',
        status: InvoiceStatus.PENDING,
        originalAmount: 100,
        createdAt: new Date('2026-06-05T10:00:00.000Z'),
        dueDate: new Date('2026-06-30T00:00:00.000Z'),
        paidAt: null,
      },
      {
        id: 'invoice-2',
        companyId: 'company-1',
        status: InvoiceStatus.PENDING,
        originalAmount: 200,
        createdAt: new Date('2026-06-01T10:00:00.000Z'),
        dueDate: new Date('2026-06-10T00:00:00.000Z'),
        paidAt: null,
      },
      {
        id: 'invoice-3',
        companyId: 'company-1',
        status: InvoiceStatus.CANCELED,
        originalAmount: 500,
        createdAt: new Date('2026-06-03T10:00:00.000Z'),
        dueDate: new Date('2026-06-20T00:00:00.000Z'),
        paidAt: null,
      },
      {
        id: 'invoice-4',
        companyId: 'company-2',
        status: InvoiceStatus.PAID,
        originalAmount: 300,
        createdAt: new Date('2026-06-08T10:00:00.000Z'),
        dueDate: new Date('2026-06-12T00:00:00.000Z'),
        paidAt: new Date('2026-06-20T12:00:00.000Z'),
      },
    ]);
    prisma.invoice.findMany.mockResolvedValueOnce([
      {
        id: 'invoice-4',
        companyId: 'company-2',
        status: InvoiceStatus.PAID,
        originalAmount: 300,
        dueDate: new Date('2026-06-12T00:00:00.000Z'),
        paidAt: new Date('2026-06-20T12:00:00.000Z'),
      },
    ]);
    prisma.collectionAttempt.findMany.mockResolvedValueOnce([
      {
        id: 'attempt-1',
        companyId: 'company-1',
        invoiceId: 'invoice-1',
        channel: 'WHATSAPP',
        status: CollectionAttemptStatus.SENT,
        createdAt: new Date('2026-06-05T11:00:00.000Z'),
      },
      {
        id: 'attempt-2',
        companyId: 'company-1',
        invoiceId: 'invoice-2',
        channel: 'EMAIL',
        status: CollectionAttemptStatus.DELIVERED,
        createdAt: new Date('2026-06-10T11:00:00.000Z'),
      },
      {
        id: 'attempt-3',
        companyId: 'company-2',
        invoiceId: 'invoice-4',
        channel: 'WHATSAPP',
        status: CollectionAttemptStatus.DELIVERED,
        createdAt: new Date('2026-06-15T11:00:00.000Z'),
      },
    ]);
    prisma.collectionAttempt.findMany.mockResolvedValueOnce([
      {
        id: 'attempt-3',
        companyId: 'company-2',
        invoiceId: 'invoice-4',
        channel: 'WHATSAPP',
        status: CollectionAttemptStatus.DELIVERED,
        createdAt: new Date('2026-06-15T11:00:00.000Z'),
      },
    ]);

    const service = new AdminAnalyticsService(
      prisma as unknown as PrismaService,
    );

    const result = await service.getAnalytics({});

    expect(result.period.key).toBe('current_month');
    expect(result.totals.totalChargedAmount).toBe(1100);
    expect(result.totals.pendingTotalAmount).toBe(300);
    expect(result.totals.overduePendingAmount).toBe(200);
    expect(result.totals.activeChargesCount).toBe(1);
    expect(result.totals.overduePendingChargesCount).toBe(1);
    expect(result.totals.canceledChargesCount).toBe(1);
    expect(result.totals.whatsappSentCount).toBe(2);
    expect(result.totals.whatsappCostAmount).toBe(0.66);
    expect(result.totals.emailSentCount).toBe(1);
    expect(result.totals.emailCostAmount).toBe(0);
    expect(result.totals.averageTicketAmount).toBe(200);
    expect(result.totals.recoveredChargesCount).toBe(1);
    expect(result.totals.recoveredAmount).toBe(300);
    expect(result.clients).toHaveLength(2);
    expect(result.clients[0]?.metrics.pendingTotalAmount).toBe(300);
    expect(result.clients[1]?.metrics.recoveredAmount).toBe(300);
  });

  it('calcula totais macro com todos os clientes filtrados ao paginar a tabela', async () => {
    const prisma = createPrismaMock();
    prisma.company.count.mockResolvedValue(2);
    prisma.company.findMany
      .mockResolvedValueOnce([
        {
          id: 'company-1',
          corporateName: 'Alpha Escola',
          document: '11111111000191',
          email: 'alpha@example.com',
          status: 'ACTIVE',
        },
      ])
      .mockResolvedValueOnce([{ id: 'company-1' }, { id: 'company-2' }]);
    prisma.invoice.findMany.mockResolvedValueOnce([
      {
        id: 'invoice-1',
        companyId: 'company-1',
        status: InvoiceStatus.PENDING,
        originalAmount: 100,
        dueDate: new Date('2026-06-30T00:00:00.000Z'),
        paidAt: null,
      },
      {
        id: 'invoice-2',
        companyId: 'company-2',
        status: InvoiceStatus.PENDING,
        originalAmount: 900,
        dueDate: new Date('2026-06-30T00:00:00.000Z'),
        paidAt: null,
      },
    ]);
    prisma.invoice.findMany.mockResolvedValueOnce([]);
    prisma.collectionAttempt.findMany.mockResolvedValueOnce([]);
    const service = new AdminAnalyticsService(
      prisma as unknown as PrismaService,
    );

    const result = await service.getAnalytics({ page: 1, pageSize: 1 });

    expect(result.clients).toHaveLength(1);
    expect(result.pagination.total).toBe(2);
    expect(result.totals.totalChargedAmount).toBe(1000);
    expect(result.totals.pendingTotalAmount).toBe(1000);
    expect(result.totals.activeChargesCount).toBe(2);
    expect(prisma.invoice.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: { in: ['company-1', 'company-2'] },
        }) as unknown,
      }),
    );
  });

  it('rejeita data customizada fora do calendario', async () => {
    const prisma = createPrismaMock();
    const service = new AdminAnalyticsService(
      prisma as unknown as PrismaService,
    );

    await expect(
      service.getAnalytics({
        period: 'custom',
        startDate: '2026-02-30',
        endDate: '2026-03-10',
      }),
    ).rejects.toThrow('Data customizada invalida.');
    expect(prisma.company.count).not.toHaveBeenCalled();
  });

  it('filtra empresas por companyId e busca textual', async () => {
    const prisma = createPrismaMock();
    prisma.company.count.mockResolvedValue(1);
    prisma.company.findMany.mockResolvedValue([
      {
        id: 'company-2',
        corporateName: 'Beta Curso',
        document: '22222222000192',
        email: 'beta@example.com',
        status: 'ACTIVE',
      },
    ]);
    prisma.invoice.findMany.mockResolvedValueOnce([]);
    prisma.invoice.findMany.mockResolvedValueOnce([]);
    prisma.collectionAttempt.findMany.mockResolvedValueOnce([]);
    prisma.collectionAttempt.findMany.mockResolvedValueOnce([]);
    const service = new AdminAnalyticsService(
      prisma as unknown as PrismaService,
    );

    await service.getAnalytics({ companyId: 'company-2', search: 'beta' });

    expect(prisma.company.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'company-2',
          OR: expect.any(Array) as unknown,
        }) as unknown,
      }),
    );
  });
});
