# Admin Visao Geral Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a separate platform-admin "Visao geral" analytics page with macro cards, per-client metrics, period filters, search, and a dedicated backend endpoint.

**Architecture:** Add an `AdminAnalyticsService` inside the existing NestJS admin module and expose it through `GET /admin/clients/analytics`, keeping analytics separate from client CRUD. Add typed API-client support and a new Next.js App Router page at `/admin/visao-geral`, while leaving `/admin/clientes` focused on cadastro/edicao.

**Tech Stack:** NestJS 11, Prisma 7, class-validator DTOs, Jest, Next.js 16 App Router, React 19, TailwindCSS, Testing Library.

---

## File Structure

- Create `api-cobranca/src/admin/dto/admin-analytics-query.dto.ts`: validates analytics query params.
- Create `api-cobranca/src/admin/admin-analytics.service.ts`: computes normalized period, company filtering, metrics aggregation, and response shape.
- Create `api-cobranca/src/admin/admin-analytics.service.spec.ts`: backend TDD coverage for period, money metrics, sent counts, costs, recovery, search, and company filter.
- Modify `api-cobranca/src/admin/admin.controller.ts`: add `GET analytics` route before `GET :id`.
- Modify `api-cobranca/src/admin/admin.module.ts`: register `AdminAnalyticsService`.
- Modify `front-cobranca/src/lib/api-client.ts`: add analytics types and `getAdminClientAnalytics`.
- Modify `front-cobranca/src/lib/__tests__/api-client-admin.test.ts`: cover analytics query string generation.
- Modify `front-cobranca/src/components/ui/Sidebar.tsx`: add admin "Visao geral" item.
- Modify `front-cobranca/src/components/ui/__tests__/Sidebar.test.tsx`: assert platform admins see both admin links.
- Create `front-cobranca/src/app/(dashboard)/admin/visao-geral/page.tsx`: analytics page.
- Create `front-cobranca/src/app/(dashboard)/admin/visao-geral/__tests__/page.test.tsx`: frontend page tests.

## Task 1: Backend Analytics Service Tests

**Files:**
- Create: `api-cobranca/src/admin/admin-analytics.service.spec.ts`
- Later implementation target: `api-cobranca/src/admin/admin-analytics.service.ts`

- [ ] **Step 1: Write failing service tests**

Create `api-cobranca/src/admin/admin-analytics.service.spec.ts` with focused tests that instantiate `AdminAnalyticsService` directly. Use Jest fake timers so `activeChargesCount` and period calculations are deterministic.

```ts
import { InvoiceStatus } from '@prisma/client';
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
        status: 'SENT',
        createdAt: new Date('2026-06-05T11:00:00.000Z'),
      },
      {
        id: 'attempt-2',
        companyId: 'company-1',
        invoiceId: 'invoice-2',
        channel: 'EMAIL',
        status: 'DELIVERED',
        createdAt: new Date('2026-06-10T11:00:00.000Z'),
      },
      {
        id: 'attempt-3',
        companyId: 'company-2',
        invoiceId: 'invoice-4',
        channel: 'WHATSAPP',
        status: 'DELIVERED',
        createdAt: new Date('2026-06-15T11:00:00.000Z'),
      },
    ]);
    prisma.collectionAttempt.findMany.mockResolvedValueOnce([
      {
        id: 'attempt-3',
        companyId: 'company-2',
        invoiceId: 'invoice-4',
        channel: 'WHATSAPP',
        status: 'DELIVERED',
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
          OR: expect.any(Array) as unknown[],
        }) as unknown,
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd api-cobranca && npm test -- admin-analytics.service.spec.ts --runInBand
```

Expected: fail because `./admin-analytics.service` does not exist.

## Task 2: Backend Analytics Service Implementation

**Files:**
- Create: `api-cobranca/src/admin/admin-analytics.service.ts`
- Create: `api-cobranca/src/admin/dto/admin-analytics-query.dto.ts`
- Test: `api-cobranca/src/admin/admin-analytics.service.spec.ts`

- [ ] **Step 1: Add query DTO**

Create `api-cobranca/src/admin/dto/admin-analytics-query.dto.ts`:

```ts
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const ADMIN_ANALYTICS_PERIODS = [
  'current_month',
  'today',
  '7d',
  '30d',
  'year',
  'custom',
] as const;

export type AdminAnalyticsPeriod = (typeof ADMIN_ANALYTICS_PERIODS)[number];

export class AdminAnalyticsQueryDto {
  @IsOptional()
  @IsIn(ADMIN_ANALYTICS_PERIODS)
  period?: AdminAnalyticsPeriod;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
```

- [ ] **Step 2: Implement analytics service**

Create `api-cobranca/src/admin/admin-analytics.service.ts` with explicit exported response types and no `any`.

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CollectionAttemptStatus,
  CollectionChannel,
  CompanyStatus,
  InvoiceStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdminAnalyticsPeriod,
  AdminAnalyticsQueryDto,
} from './dto/admin-analytics-query.dto';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const WHATSAPP_UNIT_COST = 0.33;
const SUCCESS_ATTEMPT_STATUSES: CollectionAttemptStatus[] = [
  'SENT',
  'DELIVERED',
  'OPENED',
  'CLICKED',
];

export interface AdminClientAnalyticsMetrics {
  totalChargedAmount: number;
  activeChargesCount: number;
  overduePendingChargesCount: number;
  canceledChargesCount: number;
  pendingTotalAmount: number;
  overduePendingAmount: number;
  whatsappSentCount: number;
  whatsappCostAmount: number;
  emailSentCount: number;
  emailCostAmount: number;
  averageTicketAmount: number;
  recoveredChargesCount: number;
  recoveredAmount: number;
}

export interface AdminClientAnalyticsRow {
  companyId: string;
  corporateName: string;
  document: string;
  email: string;
  status: CompanyStatus;
  metrics: AdminClientAnalyticsMetrics;
}

export interface AdminClientAnalyticsResponse {
  period: {
    key: AdminAnalyticsPeriod;
    startDate: string;
    endDate: string;
  };
  totals: AdminClientAnalyticsMetrics;
  clients: AdminClientAnalyticsRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
}

interface PeriodRange {
  key: AdminAnalyticsPeriod;
  start: Date;
  end: Date;
}

interface InvoiceMetricRecord {
  id: string;
  companyId: string;
  status: InvoiceStatus;
  originalAmount: Prisma.Decimal | number | string;
  dueDate: Date;
  paidAt: Date | null;
}

interface AttemptMetricRecord {
  id: string;
  companyId: string;
  invoiceId: string;
  channel: CollectionChannel;
  status: CollectionAttemptStatus;
  createdAt: Date;
}

interface TicketAccumulator {
  total: number;
  count: number;
}

@Injectable()
export class AdminAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAnalytics(
    query: AdminAnalyticsQueryDto,
  ): Promise<AdminClientAnalyticsResponse> {
    const period = this.resolvePeriod(query);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const companyWhere = this.buildCompanyWhere(query);

    const [totalCompanies, companies] = await Promise.all([
      this.prisma.company.count({ where: companyWhere }),
      this.prisma.company.findMany({
        where: companyWhere,
        orderBy: { corporateName: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          corporateName: true,
          document: true,
          email: true,
          status: true,
        },
      }),
    ]);

    const companyIds = companies.map((company) => company.id);
    const metricsByCompany = new Map<string, AdminClientAnalyticsMetrics>(
      companyIds.map((companyId) => [companyId, this.emptyMetrics()]),
    );
    const ticketByCompany = new Map<string, TicketAccumulator>();

    if (companyIds.length > 0) {
      await this.populateInvoiceMetrics(
        companyIds,
        period,
        metricsByCompany,
        ticketByCompany,
      );
      await this.populateAttemptMetrics(companyIds, period, metricsByCompany);
      await this.populateRecoveryMetrics(companyIds, period, metricsByCompany);
    }

    const clients = companies.map((company) => ({
      companyId: company.id,
      corporateName: company.corporateName,
      document: company.document,
      email: company.email,
      status: company.status,
      metrics: metricsByCompany.get(company.id) ?? this.emptyMetrics(),
    }));

    return {
      period: {
        key: period.key,
        startDate: period.start.toISOString(),
        endDate: period.end.toISOString(),
      },
      totals: this.sumTotals(clients, ticketByCompany),
      clients,
      pagination: {
        page,
        pageSize,
        total: totalCompanies,
      },
    };
  }

  private async populateInvoiceMetrics(
    companyIds: string[],
    period: PeriodRange,
    metricsByCompany: Map<string, AdminClientAnalyticsMetrics>,
    ticketByCompany: Map<string, TicketAccumulator>,
  ): Promise<void> {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        companyId: { in: companyIds },
        createdAt: { gte: period.start, lt: period.end },
      },
      select: {
        id: true,
        companyId: true,
        status: true,
        originalAmount: true,
        dueDate: true,
        paidAt: true,
      },
    });
    const today = this.startOfDay(new Date());

    for (const invoice of invoices as InvoiceMetricRecord[]) {
      const metrics = metricsByCompany.get(invoice.companyId);
      if (!metrics) continue;
      const amount = this.decimalToNumber(invoice.originalAmount);
      metrics.totalChargedAmount = this.roundMoney(
        metrics.totalChargedAmount + amount,
      );
      if (invoice.status === 'CANCELED') {
        metrics.canceledChargesCount += 1;
        continue;
      }
      if (invoice.status === 'PENDING') {
        metrics.pendingTotalAmount = this.roundMoney(
          metrics.pendingTotalAmount + amount,
        );
        if (invoice.dueDate < today) {
          metrics.overduePendingChargesCount += 1;
          metrics.overduePendingAmount = this.roundMoney(
            metrics.overduePendingAmount + amount,
          );
        } else {
          metrics.activeChargesCount += 1;
        }
      }
    }

    this.populateAverageTicket(
      invoices as InvoiceMetricRecord[],
      metricsByCompany,
      ticketByCompany,
    );
  }

  private async populateAttemptMetrics(
    companyIds: string[],
    period: PeriodRange,
    metricsByCompany: Map<string, AdminClientAnalyticsMetrics>,
  ): Promise<void> {
    const attempts = await this.prisma.collectionAttempt.findMany({
      where: {
        companyId: { in: companyIds },
        status: { in: SUCCESS_ATTEMPT_STATUSES },
        createdAt: { gte: period.start, lt: period.end },
      },
      select: {
        id: true,
        companyId: true,
        invoiceId: true,
        channel: true,
        status: true,
        createdAt: true,
      },
    });

    for (const attempt of attempts as AttemptMetricRecord[]) {
      const metrics = metricsByCompany.get(attempt.companyId);
      if (!metrics) continue;
      if (attempt.channel === 'WHATSAPP') {
        metrics.whatsappSentCount += 1;
        metrics.whatsappCostAmount = this.roundMoney(
          metrics.whatsappSentCount * WHATSAPP_UNIT_COST,
        );
      }
      if (attempt.channel === 'EMAIL') {
        metrics.emailSentCount += 1;
      }
    }
  }

  private async populateRecoveryMetrics(
    companyIds: string[],
    period: PeriodRange,
    metricsByCompany: Map<string, AdminClientAnalyticsMetrics>,
  ): Promise<void> {
    const paidInvoices = await this.prisma.invoice.findMany({
      where: {
        companyId: { in: companyIds },
        status: 'PAID',
        paidAt: { gte: period.start, lt: period.end },
      },
      select: {
        id: true,
        companyId: true,
        status: true,
        originalAmount: true,
        dueDate: true,
        paidAt: true,
      },
    });
    const overduePaidInvoices = (paidInvoices as InvoiceMetricRecord[]).filter(
      (invoice) => invoice.paidAt !== null && invoice.paidAt > invoice.dueDate,
    );
    const invoiceIds = overduePaidInvoices.map((invoice) => invoice.id);
    if (invoiceIds.length === 0) return;

    const attempts = await this.prisma.collectionAttempt.findMany({
      where: {
        companyId: { in: companyIds },
        invoiceId: { in: invoiceIds },
        channel: { in: ['EMAIL', 'WHATSAPP'] },
        status: { in: SUCCESS_ATTEMPT_STATUSES },
      },
      select: {
        id: true,
        companyId: true,
        invoiceId: true,
        channel: true,
        status: true,
        createdAt: true,
      },
    });
    const attemptsByInvoice = new Map<string, AttemptMetricRecord[]>();
    for (const attempt of attempts as AttemptMetricRecord[]) {
      attemptsByInvoice.set(attempt.invoiceId, [
        ...(attemptsByInvoice.get(attempt.invoiceId) ?? []),
        attempt,
      ]);
    }

    for (const invoice of overduePaidInvoices) {
      const paidAt = invoice.paidAt;
      if (!paidAt) continue;
      const hasAttemptBeforePayment = (
        attemptsByInvoice.get(invoice.id) ?? []
      ).some((attempt) => attempt.createdAt < paidAt);
      if (!hasAttemptBeforePayment) continue;
      const metrics = metricsByCompany.get(invoice.companyId);
      if (!metrics) continue;
      metrics.recoveredChargesCount += 1;
      metrics.recoveredAmount = this.roundMoney(
        metrics.recoveredAmount + this.decimalToNumber(invoice.originalAmount),
      );
    }
  }

  private populateAverageTicket(
    invoices: InvoiceMetricRecord[],
    metricsByCompany: Map<string, AdminClientAnalyticsMetrics>,
    ticketByCompany: Map<string, TicketAccumulator>,
  ): void {
    for (const invoice of invoices) {
      if (invoice.status === 'CANCELED') continue;
      const current = ticketByCompany.get(invoice.companyId) ?? {
        total: 0,
        count: 0,
      };
      current.total += this.decimalToNumber(invoice.originalAmount);
      current.count += 1;
      ticketByCompany.set(invoice.companyId, current);
    }
    for (const [companyId, ticket] of ticketByCompany) {
      const metrics = metricsByCompany.get(companyId);
      if (!metrics || ticket.count === 0) continue;
      metrics.averageTicketAmount = this.roundMoney(ticket.total / ticket.count);
    }
  }

  private sumTotals(
    rows: AdminClientAnalyticsRow[],
    ticketByCompany: Map<string, TicketAccumulator>,
  ): AdminClientAnalyticsMetrics {
    const totals = this.emptyMetrics();
    for (const row of rows) {
      const metrics = row.metrics;
      totals.totalChargedAmount += metrics.totalChargedAmount;
      totals.activeChargesCount += metrics.activeChargesCount;
      totals.overduePendingChargesCount += metrics.overduePendingChargesCount;
      totals.canceledChargesCount += metrics.canceledChargesCount;
      totals.pendingTotalAmount += metrics.pendingTotalAmount;
      totals.overduePendingAmount += metrics.overduePendingAmount;
      totals.whatsappSentCount += metrics.whatsappSentCount;
      totals.emailSentCount += metrics.emailSentCount;
      totals.recoveredChargesCount += metrics.recoveredChargesCount;
      totals.recoveredAmount += metrics.recoveredAmount;
    }
    const ticket = Array.from(ticketByCompany.values()).reduce(
      (accumulator, current) => ({
        total: accumulator.total + current.total,
        count: accumulator.count + current.count,
      }),
      { total: 0, count: 0 },
    );
    totals.totalChargedAmount = this.roundMoney(totals.totalChargedAmount);
    totals.pendingTotalAmount = this.roundMoney(totals.pendingTotalAmount);
    totals.overduePendingAmount = this.roundMoney(totals.overduePendingAmount);
    totals.whatsappCostAmount = this.roundMoney(
      totals.whatsappSentCount * WHATSAPP_UNIT_COST,
    );
    totals.recoveredAmount = this.roundMoney(totals.recoveredAmount);
    totals.averageTicketAmount =
      ticket.count > 0 ? this.roundMoney(ticket.total / ticket.count) : 0;
    return totals;
  }

  private buildCompanyWhere(
    query: AdminAnalyticsQueryDto,
  ): Prisma.CompanyWhereInput {
    const where: Prisma.CompanyWhereInput = {};
    if (query.companyId) {
      where.id = query.companyId;
    }
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { corporateName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { document: { contains: search.replace(/\D/g, '') || search } },
      ];
    }
    return where;
  }

  private resolvePeriod(query: AdminAnalyticsQueryDto): PeriodRange {
    const key = query.period ?? 'current_month';
    const now = new Date();
    if (key === 'custom') {
      if (!query.startDate || !query.endDate) {
        throw new BadRequestException('Periodo customizado incompleto.');
      }
      const start = this.parseDateOnly(query.startDate);
      const end = this.addDays(this.parseDateOnly(query.endDate), 1);
      if (end <= start) {
        throw new BadRequestException('Periodo customizado invalido.');
      }
      return { key, start, end };
    }
    if (key === 'today') {
      const start = this.startOfDay(now);
      return { key, start, end: this.addDays(start, 1) };
    }
    if (key === '7d' || key === '30d') {
      const days = key === '7d' ? 7 : 30;
      const end = this.addDays(this.startOfDay(now), 1);
      return { key, start: this.addDays(end, -days), end };
    }
    if (key === 'year') {
      const start = new Date(now.getFullYear(), 0, 1);
      return { key, start, end: new Date(now.getFullYear() + 1, 0, 1) };
    }
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { key, start, end: new Date(now.getFullYear(), now.getMonth() + 1, 1) };
  }

  private parseDateOnly(value: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
      throw new BadRequestException('Data customizada invalida.');
    }
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  private emptyMetrics(): AdminClientAnalyticsMetrics {
    return {
      totalChargedAmount: 0,
      activeChargesCount: 0,
      overduePendingChargesCount: 0,
      canceledChargesCount: 0,
      pendingTotalAmount: 0,
      overduePendingAmount: 0,
      whatsappSentCount: 0,
      whatsappCostAmount: 0,
      emailSentCount: 0,
      emailCostAmount: 0,
      averageTicketAmount: 0,
      recoveredChargesCount: 0,
      recoveredAmount: 0,
    };
  }

  private startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * DAY_IN_MS);
  }

  private decimalToNumber(value: Prisma.Decimal | number | string): number {
    if (typeof value === 'number') return value;
    return Number(value);
  }

  private roundMoney(value: number): number {
    return Number(value.toFixed(2));
  }
}
```

- [ ] **Step 3: Run service tests**

Run:

```bash
cd api-cobranca && npm test -- admin-analytics.service.spec.ts --runInBand
```

Expected: pass.

## Task 3: Backend Controller and Module Wiring

**Files:**
- Modify: `api-cobranca/src/admin/admin.controller.ts`
- Modify: `api-cobranca/src/admin/admin.module.ts`
- Test: `api-cobranca/src/admin/admin-analytics.service.spec.ts`

- [ ] **Step 1: Wire service into module**

Modify `api-cobranca/src/admin/admin.module.ts` so providers include analytics:

```ts
import { Module } from '@nestjs/common';
import { PaymentModule } from '../payment/payment.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PlatformAdminGuard } from './guards/platform-admin.guard';

@Module({
  imports: [PaymentModule, WhatsappModule],
  controllers: [AdminController],
  providers: [AdminService, AdminAnalyticsService, PlatformAdminGuard],
})
export class AdminModule {}
```

- [ ] **Step 2: Add analytics route before `:id`**

Modify `api-cobranca/src/admin/admin.controller.ts`. The `analytics` route must be above `@Get(':id')`.

```ts
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ThrottleGuard } from '../common/guards/throttle.guard';
import {
  CreateAdminClientDto,
  ResetClientPasswordDto,
  UpdateAdminClientDto,
} from './dto/admin-client.dto';
import { AdminAnalyticsQueryDto } from './dto/admin-analytics-query.dto';
import {
  AdminAnalyticsService,
  type AdminClientAnalyticsResponse,
} from './admin-analytics.service';
import { AdminClientResponse, AdminService } from './admin.service';
import { PlatformAdminGuard } from './guards/platform-admin.guard';

@Controller('admin/clients')
@UseGuards(JwtAuthGuard, PlatformAdminGuard, ThrottleGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly adminAnalyticsService: AdminAnalyticsService,
  ) {}

  @Get()
  async listClients(): Promise<AdminClientResponse[]> {
    return this.adminService.listClients();
  }

  @Get('analytics')
  async getAnalytics(
    @Query() query: AdminAnalyticsQueryDto,
  ): Promise<AdminClientAnalyticsResponse> {
    return this.adminAnalyticsService.getAnalytics(query);
  }

  @Get(':id')
  async getClient(@Param('id') id: string): Promise<AdminClientResponse> {
    return this.adminService.getClient(id);
  }
}
```

Keep the existing `createClient`, `updateClient`, and `resetPassword` methods below this snippet unchanged.

- [ ] **Step 3: Run backend admin tests**

Run:

```bash
cd api-cobranca && npm test -- admin --runInBand
```

Expected: admin tests pass.

## Task 4: Frontend API Client Contract

**Files:**
- Modify: `front-cobranca/src/lib/api-client.ts`
- Modify: `front-cobranca/src/lib/__tests__/api-client-admin.test.ts`

- [ ] **Step 1: Write failing API-client test**

Append this test to `front-cobranca/src/lib/__tests__/api-client-admin.test.ts`:

```ts
it("fetches admin client analytics with filled query params only", async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      period: {
        key: "custom",
        startDate: "2026-06-01T00:00:00.000Z",
        endDate: "2026-07-01T00:00:00.000Z",
      },
      totals: {
        totalChargedAmount: 100,
        activeChargesCount: 1,
        overduePendingChargesCount: 0,
        canceledChargesCount: 0,
        pendingTotalAmount: 100,
        overduePendingAmount: 0,
        whatsappSentCount: 2,
        whatsappCostAmount: 0.66,
        emailSentCount: 1,
        emailCostAmount: 0,
        averageTicketAmount: 100,
        recoveredChargesCount: 0,
        recoveredAmount: 0,
      },
      clients: [],
      pagination: { page: 1, pageSize: 50, total: 0 },
    }),
  } as Response);
  const apiClient = new ApiClient("http://api.test", "token");

  await apiClient.getAdminClientAnalytics({
    period: "custom",
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    search: "alpha",
    page: 1,
    pageSize: 25,
  });

  expect(mockFetch.mock.calls[0]?.[0]).toBe(
    "http://api.test/admin/clients/analytics?period=custom&startDate=2026-06-01&endDate=2026-06-30&search=alpha&page=1&pageSize=25",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd front-cobranca && npx jest src/lib/__tests__/api-client-admin.test.ts --runInBand
```

Expected: fail because `getAdminClientAnalytics` does not exist.

- [ ] **Step 3: Add analytics types and method**

Modify `front-cobranca/src/lib/api-client.ts` near the existing `AdminClient` types:

```ts
export type AdminAnalyticsPeriod =
  | "current_month"
  | "today"
  | "7d"
  | "30d"
  | "year"
  | "custom";

export interface AdminClientAnalyticsMetrics {
  totalChargedAmount: number;
  activeChargesCount: number;
  overduePendingChargesCount: number;
  canceledChargesCount: number;
  pendingTotalAmount: number;
  overduePendingAmount: number;
  whatsappSentCount: number;
  whatsappCostAmount: number;
  emailSentCount: number;
  emailCostAmount: number;
  averageTicketAmount: number;
  recoveredChargesCount: number;
  recoveredAmount: number;
}

export interface AdminClientAnalyticsRow {
  companyId: string;
  corporateName: string;
  document: string;
  email: string;
  status: CompanyStatus;
  metrics: AdminClientAnalyticsMetrics;
}

export interface AdminClientAnalyticsResponse {
  period: {
    key: AdminAnalyticsPeriod;
    startDate: string;
    endDate: string;
  };
  totals: AdminClientAnalyticsMetrics;
  clients: AdminClientAnalyticsRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
}

export interface AdminClientAnalyticsParams {
  period?: AdminAnalyticsPeriod;
  startDate?: string;
  endDate?: string;
  companyId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}
```

Add a private query-string helper inside `ApiClient`:

```ts
  private buildQueryString(
    params: Record<string, string | number | undefined>,
  ): string {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === "") {
        return;
      }
      searchParams.set(key, String(value));
    });
    const query = searchParams.toString();
    return query ? `?${query}` : "";
  }
```

Add the admin method near existing admin methods:

```ts
  async getAdminClientAnalytics(
    params: AdminClientAnalyticsParams = {},
  ): Promise<AdminClientAnalyticsResponse> {
    const query = this.buildQueryString(params);
    return this.fetch<AdminClientAnalyticsResponse>(
      `/admin/clients/analytics${query}`,
    );
  }
```

- [ ] **Step 4: Run API-client tests**

Run:

```bash
cd front-cobranca && npx jest src/lib/__tests__/api-client-admin.test.ts --runInBand
```

Expected: pass.

## Task 5: Sidebar Admin Navigation

**Files:**
- Modify: `front-cobranca/src/components/ui/Sidebar.tsx`
- Modify: `front-cobranca/src/components/ui/__tests__/Sidebar.test.tsx`

- [ ] **Step 1: Write failing sidebar test**

Update the platform-admin test in `front-cobranca/src/components/ui/__tests__/Sidebar.test.tsx`:

```ts
it("shows only admin navigation for platform admins", () => {
  mockPathname = "/admin/visao-geral";
  mockRole = "PLATFORM_ADMIN";

  renderSidebar();

  expect(
    screen.getByRole("link", { name: /visao geral/i }),
  ).toHaveAttribute("href", "/admin/visao-geral");
  expect(
    screen.getByRole("link", { name: /clientes/i }),
  ).toHaveAttribute("href", "/admin/clientes");
  expect(
    screen.queryByRole("link", { name: /dashboard/i }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: /cobrancas/i }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: /baixas/i }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: /recorrentes/i }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: /inbox whatsapp/i }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /configuracoes/i }),
  ).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd front-cobranca && npx jest src/components/ui/__tests__/Sidebar.test.tsx --runInBand
```

Expected: fail because the "Visao geral" admin link does not exist.

- [ ] **Step 3: Add menu item**

Modify `front-cobranca/src/components/ui/Sidebar.tsx` imports and `adminItems`:

```ts
import {
  BellRing,
  Building2,
  CalendarClock,
  ChevronDown,
  Database,
  FileText,
  HandCoins,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  MessageSquareText,
  MessageSquare,
  Settings,
  SlidersHorizontal,
  X,
} from "lucide-react";
```

```ts
const adminItems = [
  {
    href: "/admin/visao-geral",
    label: "Visao geral",
    icon: LayoutDashboard,
  },
  {
    href: "/admin/clientes",
    label: "Clientes",
    icon: Building2,
  },
];
```

- [ ] **Step 4: Run sidebar tests**

Run:

```bash
cd front-cobranca && npx jest src/components/ui/__tests__/Sidebar.test.tsx --runInBand
```

Expected: pass.

## Task 6: Admin Visao Geral Page

**Files:**
- Create: `front-cobranca/src/app/(dashboard)/admin/visao-geral/page.tsx`
- Create: `front-cobranca/src/app/(dashboard)/admin/visao-geral/__tests__/page.test.tsx`

- [ ] **Step 1: Write failing page test**

Create `front-cobranca/src/app/(dashboard)/admin/visao-geral/__tests__/page.test.tsx`:

```tsx
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AdminClientAnalyticsResponse } from "@/lib/api-client";
import AdminOverviewPage from "../page";

const mockGetAdminClientAnalytics = jest.fn() as jest.MockedFunction<
  (params?: unknown) => Promise<AdminClientAnalyticsResponse>
>;

jest.mock("@/lib/use-api-client", () => ({
  useApiClient: () => ({
    getAdminClientAnalytics: mockGetAdminClientAnalytics,
  }),
}));

jest.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: {
        role: "PLATFORM_ADMIN",
      },
    },
  }),
}));

function createAnalyticsFixture(): AdminClientAnalyticsResponse {
  return {
    period: {
      key: "current_month",
      startDate: "2026-06-01T00:00:00.000Z",
      endDate: "2026-07-01T00:00:00.000Z",
    },
    totals: {
      totalChargedAmount: 1100,
      activeChargesCount: 1,
      overduePendingChargesCount: 1,
      canceledChargesCount: 1,
      pendingTotalAmount: 300,
      overduePendingAmount: 200,
      whatsappSentCount: 2,
      whatsappCostAmount: 0.66,
      emailSentCount: 1,
      emailCostAmount: 0,
      averageTicketAmount: 200,
      recoveredChargesCount: 1,
      recoveredAmount: 300,
    },
    clients: [
      {
        companyId: "company-1",
        corporateName: "Alpha Escola",
        document: "11111111000191",
        email: "alpha@example.com",
        status: "ACTIVE",
        metrics: {
          totalChargedAmount: 800,
          activeChargesCount: 1,
          overduePendingChargesCount: 1,
          canceledChargesCount: 1,
          pendingTotalAmount: 300,
          overduePendingAmount: 200,
          whatsappSentCount: 1,
          whatsappCostAmount: 0.33,
          emailSentCount: 1,
          emailCostAmount: 0,
          averageTicketAmount: 150,
          recoveredChargesCount: 0,
          recoveredAmount: 0,
        },
      },
    ],
    pagination: { page: 1, pageSize: 50, total: 1 },
  };
}

describe("AdminOverviewPage", () => {
  beforeEach(() => {
    mockGetAdminClientAnalytics.mockReset();
    mockGetAdminClientAnalytics.mockResolvedValue(createAnalyticsFixture());
  });

  it("renders macro cards and client table", async () => {
    render(<AdminOverviewPage />);

    expect(await screen.findByText("Visao geral")).toBeInTheDocument();
    expect(screen.getByText("R$ 1.100,00")).toBeInTheDocument();
    expect(screen.getByText("Alpha Escola")).toBeInTheDocument();
    expect(screen.getByText("R$ 0,66")).toBeInTheDocument();
    expect(mockGetAdminClientAnalytics).toHaveBeenCalledWith({
      period: "current_month",
      search: "",
    });
  });

  it("reloads analytics when searching for a client", async () => {
    const user = userEvent.setup();
    render(<AdminOverviewPage />);

    await screen.findByText("Alpha Escola");
    await user.type(screen.getByLabelText("Buscar cliente"), "beta");

    await waitFor(() =>
      expect(mockGetAdminClientAnalytics).toHaveBeenLastCalledWith({
        period: "current_month",
        search: "beta",
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd front-cobranca && npx jest src/app/'(dashboard)'/admin/visao-geral/__tests__/page.test.tsx --runInBand
```

Expected: fail because the page does not exist.

- [ ] **Step 3: Implement page**

Create `front-cobranca/src/app/(dashboard)/admin/visao-geral/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import {
  AlertCircle,
  BarChart3,
  CircleDollarSign,
  Loader2,
  Mail,
  MessageCircle,
  Search,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import type {
  AdminAnalyticsPeriod,
  AdminClientAnalyticsMetrics,
  AdminClientAnalyticsResponse,
} from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";

const periodOptions: Array<{ label: string; value: AdminAnalyticsPeriod }> = [
  { label: "Mes atual", value: "current_month" },
  { label: "Hoje", value: "today" },
  { label: "7 dias", value: "7d" },
  { label: "30 dias", value: "30d" },
  { label: "Ano", value: "year" },
];

const emptyMetrics: AdminClientAnalyticsMetrics = {
  totalChargedAmount: 0,
  activeChargesCount: 0,
  overduePendingChargesCount: 0,
  canceledChargesCount: 0,
  pendingTotalAmount: 0,
  overduePendingAmount: 0,
  whatsappSentCount: 0,
  whatsappCostAmount: 0,
  emailSentCount: 0,
  emailCostAmount: 0,
  averageTicketAmount: 0,
  recoveredChargesCount: 0,
  recoveredAmount: 0,
};

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatCount(value: number): string {
  return value.toLocaleString("pt-BR");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Nao foi possivel carregar a visao geral.";
}

export default function AdminOverviewPage() {
  const apiClient = useApiClient();
  const { data: session } = useSession();
  const [period, setPeriod] = useState<AdminAnalyticsPeriod>("current_month");
  const [search, setSearch] = useState("");
  const [analytics, setAnalytics] =
    useState<AdminClientAnalyticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isPlatformAdmin = session?.user.role === "PLATFORM_ADMIN";

  const loadAnalytics = useCallback(async (): Promise<void> => {
    if (!isPlatformAdmin) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiClient.getAdminClientAnalytics({ period, search });
      setAnalytics(data);
    } catch (loadError: unknown) {
      setError(getErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [apiClient, isPlatformAdmin, period, search]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const totals = analytics?.totals ?? emptyMetrics;
  const cards = useMemo(
    () => [
      {
        label: "Valor cobrado",
        value: formatBRL(totals.totalChargedAmount),
        helper: "Cobrancas criadas no periodo",
        icon: CircleDollarSign,
      },
      {
        label: "Pendente total",
        value: formatBRL(totals.pendingTotalAmount),
        helper: "Dentro do prazo e vencidas",
        icon: WalletCards,
      },
      {
        label: "Vencido pendente",
        value: formatBRL(totals.overduePendingAmount),
        helper: `${formatCount(totals.overduePendingChargesCount)} cobrancas vencidas`,
        icon: AlertCircle,
      },
      {
        label: "Recuperado",
        value: formatBRL(totals.recoveredAmount),
        helper: `${formatCount(totals.recoveredChargesCount)} cobrancas recuperadas`,
        icon: TrendingUp,
      },
      {
        label: "Ticket medio",
        value: formatBRL(totals.averageTicketAmount),
        helper: "Pendente + pagas, sem canceladas",
        icon: BarChart3,
      },
      {
        label: "WhatsApp",
        value: formatBRL(totals.whatsappCostAmount),
        helper: `${formatCount(totals.whatsappSentCount)} envios`,
        icon: MessageCircle,
      },
      {
        label: "E-mails",
        value: formatCount(totals.emailSentCount),
        helper: "Custo R$ 0,00",
        icon: Mail,
      },
    ],
    [totals],
  );

  if (!isPlatformAdmin) {
    return (
      <main className="min-h-full bg-slate-50 p-4 lg:p-8">
        <div className="rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-700">
          Acesso restrito.
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-full bg-slate-50">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 lg:p-8">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Visao geral</h1>
            <p className="mt-1 text-sm text-slate-500">
              Indicadores financeiros e operacionais por cliente da plataforma.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-md border border-slate-200 bg-white p-1 sm:flex">
            {periodOptions.map((option) => {
              const active = period === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setPeriod(option.value)}
                  className={`rounded-md px-3 py-2 text-sm font-semibold transition ${
                    active
                      ? "bg-slate-900 text-white"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </header>

        <section className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-4 md:flex-row md:items-center">
          <label className="relative flex-1">
            <span className="sr-only">Buscar cliente</span>
            <Search
              size={17}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              aria-label="Buscar cliente"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar cliente por nome, email ou documento"
              className="h-10 w-full rounded-md border border-slate-200 pl-10 pr-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            />
          </label>
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" />
              Carregando
            </div>
          )}
        </section>

        {error && (
          <div className="flex items-start gap-3 rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 shrink-0" size={18} />
            <span>{error}</span>
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <article
                key={card.label}
                className="rounded-md border border-slate-200 bg-white p-5"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                  <Icon size={20} />
                </div>
                <p className="text-sm font-medium text-slate-500">
                  {card.label}
                </p>
                <strong className="mt-2 block text-2xl font-bold text-slate-900">
                  {card.value}
                </strong>
                <p className="mt-2 text-sm text-slate-500">{card.helper}</p>
              </article>
            );
          })}
        </section>

        <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900">
              Clientes no periodo
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Cobrado</th>
                  <th className="px-4 py-3">Pendente</th>
                  <th className="px-4 py-3">Vencido</th>
                  <th className="px-4 py-3">Ativas</th>
                  <th className="px-4 py-3">Canceladas</th>
                  <th className="px-4 py-3">Recuperado</th>
                  <th className="px-4 py-3">WhatsApp</th>
                  <th className="px-4 py-3">E-mails</th>
                  <th className="px-4 py-3">Ticket medio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!isLoading && analytics?.clients.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-6 text-slate-500">
                      Nenhum cliente encontrado no periodo.
                    </td>
                  </tr>
                ) : (
                  analytics?.clients.map((client) => (
                    <tr key={client.companyId} className="align-top">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900">
                          {client.corporateName}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {client.email}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        {formatBRL(client.metrics.totalChargedAmount)}
                      </td>
                      <td className="px-4 py-3">
                        {formatBRL(client.metrics.pendingTotalAmount)}
                      </td>
                      <td className="px-4 py-3">
                        {formatBRL(client.metrics.overduePendingAmount)}
                      </td>
                      <td className="px-4 py-3">
                        {formatCount(client.metrics.activeChargesCount)}
                      </td>
                      <td className="px-4 py-3">
                        {formatCount(client.metrics.canceledChargesCount)}
                      </td>
                      <td className="px-4 py-3">
                        {formatBRL(client.metrics.recoveredAmount)}
                      </td>
                      <td className="px-4 py-3">
                        <p>{formatCount(client.metrics.whatsappSentCount)}</p>
                        <p className="text-xs text-slate-500">
                          {formatBRL(client.metrics.whatsappCostAmount)}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        {formatCount(client.metrics.emailSentCount)}
                      </td>
                      <td className="px-4 py-3">
                        {formatBRL(client.metrics.averageTicketAmount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Run page test**

Run:

```bash
cd front-cobranca && npx jest src/app/'(dashboard)'/admin/visao-geral/__tests__/page.test.tsx --runInBand
```

Expected: pass.

## Task 7: Verification and Cleanup

**Files:**
- Verify all modified files from Tasks 1-6.

- [ ] **Step 1: Run focused backend tests**

Run:

```bash
cd api-cobranca && npm test -- admin --runInBand
```

Expected: pass.

- [ ] **Step 2: Run focused frontend tests**

Run:

```bash
cd front-cobranca && npx jest src/lib/__tests__/api-client-admin.test.ts src/components/ui/__tests__/Sidebar.test.tsx src/app/'(dashboard)'/admin/visao-geral/__tests__/page.test.tsx --runInBand
```

Expected: pass.

- [ ] **Step 3: Run type/build checks where practical**

Run:

```bash
cd api-cobranca && npm run build
```

Expected: build succeeds.

Run:

```bash
cd front-cobranca && npm run build
```

Expected: build succeeds. If this build is blocked by unrelated existing workspace changes, record the exact failure in the final handoff.

- [ ] **Step 4: Review git diff**

Run:

```bash
git diff -- api-cobranca/src/admin front-cobranca/src/lib/api-client.ts front-cobranca/src/lib/__tests__/api-client-admin.test.ts front-cobranca/src/components/ui/Sidebar.tsx front-cobranca/src/components/ui/__tests__/Sidebar.test.tsx front-cobranca/src/app/'(dashboard)'/admin/visao-geral
```

Expected: diff is limited to the admin analytics backend, API client, sidebar nav, and new Visao geral page.
