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

    const [totalCompanies, companies, metricCompanies] = await Promise.all([
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
      this.prisma.company.findMany({
        where: companyWhere,
        select: {
          id: true,
        },
      }),
    ]);

    const companyIds = metricCompanies.map((company) => company.id);
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

    const clients: AdminClientAnalyticsRow[] = companies.map((company) => ({
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
      totals: this.sumTotals(metricsByCompany, ticketByCompany),
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

    for (const invoice of invoices) {
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

      const ticket = ticketByCompany.get(invoice.companyId) ?? {
        total: 0,
        count: 0,
      };
      ticket.total += amount;
      ticket.count += 1;
      ticketByCompany.set(invoice.companyId, ticket);

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

    this.populateAverageTicket(metricsByCompany, ticketByCompany);
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

    for (const attempt of attempts) {
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
    const overduePaidInvoices = paidInvoices.filter(
      (invoice) => invoice.paidAt !== null && invoice.paidAt > invoice.dueDate,
    );
    const invoiceIds = overduePaidInvoices.map((invoice) => invoice.id);

    if (invoiceIds.length === 0) {
      return;
    }

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
    const attemptsByInvoice = this.groupAttemptsByInvoice(attempts);

    for (const invoice of overduePaidInvoices) {
      const paidAt = invoice.paidAt;
      if (!paidAt) continue;

      const hasAttemptBeforePayment = (
        attemptsByInvoice.get(invoice.id) ?? []
      ).some((attempt) => attempt.createdAt < paidAt);

      if (!hasAttemptBeforePayment) {
        continue;
      }

      const metrics = metricsByCompany.get(invoice.companyId);
      if (!metrics) continue;

      metrics.recoveredChargesCount += 1;
      metrics.recoveredAmount = this.roundMoney(
        metrics.recoveredAmount + this.decimalToNumber(invoice.originalAmount),
      );
    }
  }

  private populateAverageTicket(
    metricsByCompany: Map<string, AdminClientAnalyticsMetrics>,
    ticketByCompany: Map<string, TicketAccumulator>,
  ): void {
    for (const [companyId, ticket] of ticketByCompany) {
      const metrics = metricsByCompany.get(companyId);
      if (!metrics || ticket.count === 0) continue;

      metrics.averageTicketAmount = this.roundMoney(ticket.total / ticket.count);
    }
  }

  private groupAttemptsByInvoice(
    attempts: AttemptMetricRecord[],
  ): Map<string, AttemptMetricRecord[]> {
    const attemptsByInvoice = new Map<string, AttemptMetricRecord[]>();

    for (const attempt of attempts) {
      attemptsByInvoice.set(attempt.invoiceId, [
        ...(attemptsByInvoice.get(attempt.invoiceId) ?? []),
        attempt,
      ]);
    }

    return attemptsByInvoice;
  }

  private sumTotals(
    metricsByCompany: Map<string, AdminClientAnalyticsMetrics>,
    ticketByCompany: Map<string, TicketAccumulator>,
  ): AdminClientAnalyticsMetrics {
    const totals = this.emptyMetrics();

    for (const metrics of metricsByCompany.values()) {
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
    return {
      key,
      start,
      end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
    };
  }

  private parseDateOnly(value: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

    if (!match) {
      throw new BadRequestException('Data customizada invalida.');
    }

    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const parsedDate = new Date(year, month, day);

    if (
      parsedDate.getFullYear() !== year ||
      parsedDate.getMonth() !== month ||
      parsedDate.getDate() !== day
    ) {
      throw new BadRequestException('Data customizada invalida.');
    }

    return parsedDate;
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
