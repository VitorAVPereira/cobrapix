import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingLimitService } from '../queue/services/messaging-limit.service';
import {
  addDays,
  dashboardBuckets,
  daysBetween,
  resolveDashboardRange,
  saoPauloDate,
  saoPauloStart,
  type DashboardPeriodKey,
  type DashboardRange,
} from './dashboard-period';

type PaymentMethodGroup = 'PIX' | 'BOLETO' | 'CARD';
type AgingRange = '1-15' | '16-30' | '31-60' | '60+';

export interface CompanyDashboardResponse {
  period: DashboardRange;
  received: { amount: number; count: number };
  collectionRate: {
    dueAmount: number;
    paidAmount: number;
    rate: number | null;
    previousRate: number | null;
  };
  open: {
    amount: number;
    count: number;
    upcomingAmount: number;
    upcomingCount: number;
    overdueAmount: number;
    overdueCount: number;
  };
  overdueAging: { range: AgingRange; amount: number; count: number }[];
  receivedSeries: { date: string; amount: number; count: number }[];
  receivedByMethod: {
    method: PaymentMethodGroup;
    amount: number;
    count: number;
  }[];
  whatsapp: {
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    replies: number;
  };
  email: { sent: number; delivered: number; opened: number; clicked: number };
}

// BOLIX is a boleto for the company and its payers.
const METHOD_GROUP: Record<string, PaymentMethodGroup> = {
  PIX: 'PIX',
  BOLETO: 'BOLETO',
  BOLIX: 'BOLETO',
  CREDIT_CARD: 'CARD',
};

const AGING: { range: AgingRange; maxDays: number }[] = [
  { range: '1-15', maxDays: 15 },
  { range: '16-30', maxDays: 30 },
  { range: '31-60', maxDays: 60 },
  { range: '60+', maxDays: Infinity },
];

/** Amounts in reais with cent precision, summed in cents to avoid float drift. */
const toCents = (value: Prisma.Decimal | null | undefined): number =>
  value ? Math.round(value.toNumber() * 100) : 0;
const toReais = (cents: number): number => cents / 100;

@Injectable()
export class CompanyDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messagingLimit: MessagingLimitService,
    private readonly email: EmailService,
  ) {}

  async get(
    companyId: string,
    key: DashboardPeriodKey,
    custom: { startDate?: string; endDate?: string },
    now = new Date(),
  ): Promise<CompanyDashboardResponse> {
    const range = resolveDashboardRange(key, now, custom);
    const current = this.instants(range.startDate, range.endDate);
    // Due dates are calendar dates stored in UTC, so they are compared as dates.
    const todayDue = new Date(`${saoPauloDate(now)}T00:00:00Z`);

    const [paid, rate, previousRate, pending, whatsapp, email] =
      await Promise.all([
        this.prisma.invoice.findMany({
          where: { companyId, status: 'PAID', paidAt: current },
          select: {
            originalAmount: true,
            paidAt: true,
            billingType: true,
            paymentCharges: {
              where: { status: 'PAID' },
              orderBy: { paidAt: 'desc' },
              take: 1,
              select: { billingMethod: true },
            },
          },
        }),
        this.collectionRate(companyId, range.startDate, range.endDate),
        this.collectionRate(
          companyId,
          range.previousStartDate,
          range.previousEndDate,
        ),
        this.prisma.invoice.findMany({
          where: { companyId, status: 'PENDING' },
          select: { originalAmount: true, dueDate: true },
        }),
        this.messagingLimit.getInteractionStats(companyId, {
          start: current.gte,
          end: current.lt,
        }),
        this.email.getStats(companyId, { start: current.gte, end: current.lt }),
      ]);

    const series = new Map(
      dashboardBuckets(range).map((date) => [date, { cents: 0, count: 0 }]),
    );
    const methods = new Map<
      PaymentMethodGroup,
      { cents: number; count: number }
    >(
      (['PIX', 'BOLETO', 'CARD'] as const).map((method) => [
        method,
        { cents: 0, count: 0 },
      ]),
    );
    let receivedCents = 0;
    for (const invoice of paid) {
      const cents = toCents(invoice.originalAmount);
      receivedCents += cents;
      const date = saoPauloDate(invoice.paidAt!);
      const bucket = series.get(
        range.granularity === 'day' ? date : date.slice(0, 7),
      );
      if (bucket) {
        bucket.cents += cents;
        bucket.count += 1;
      }
      // The paid charge tells how it was paid; older invoices have no charge.
      const method =
        METHOD_GROUP[
          invoice.paymentCharges[0]?.billingMethod ?? invoice.billingType
        ];
      const total = method && methods.get(method);
      if (total) {
        total.cents += cents;
        total.count += 1;
      }
    }

    const aging = AGING.map(({ range: agingRange, maxDays }) => ({
      range: agingRange,
      maxDays,
      cents: 0,
      count: 0,
    }));
    let openCents = 0;
    let overdueCents = 0;
    let overdueCount = 0;
    for (const invoice of pending) {
      const cents = toCents(invoice.originalAmount);
      openCents += cents;
      if (invoice.dueDate >= todayDue) continue;
      overdueCents += cents;
      overdueCount += 1;
      const days = daysBetween(
        invoice.dueDate.toISOString().slice(0, 10),
        saoPauloDate(now),
      );
      const bucket = aging.find(({ maxDays }) => days <= maxDays);
      if (bucket) {
        bucket.cents += cents;
        bucket.count += 1;
      }
    }

    return {
      period: range,
      received: {
        amount: toReais(receivedCents),
        count: paid.length,
      },
      collectionRate: {
        dueAmount: toReais(rate.dueCents),
        paidAmount: toReais(rate.paidCents),
        rate: rate.rate,
        previousRate: previousRate.rate,
      },
      open: {
        amount: toReais(openCents),
        count: pending.length,
        upcomingAmount: toReais(openCents - overdueCents),
        upcomingCount: pending.length - overdueCount,
        overdueAmount: toReais(overdueCents),
        overdueCount,
      },
      overdueAging: aging.map(({ range: agingRange, cents, count }) => ({
        range: agingRange,
        amount: toReais(cents),
        count,
      })),
      receivedSeries: [...series].map(([date, { cents, count }]) => ({
        date,
        amount: toReais(cents),
        count,
      })),
      receivedByMethod: [...methods].map(([method, { cents, count }]) => ({
        method,
        amount: toReais(cents),
        count,
      })),
      whatsapp: {
        sent: whatsapp.outbound,
        delivered: whatsapp.delivered,
        read: whatsapp.read,
        failed: whatsapp.failed,
        replies: whatsapp.inbound,
      },
      email: {
        sent: email.sent,
        delivered: email.delivered,
        opened: email.opened,
        clicked: email.clicked,
      },
    };
  }

  private instants(
    startDate: string,
    endDate: string,
  ): { gte: Date; lt: Date } {
    return {
      gte: saoPauloStart(startDate),
      lt: saoPauloStart(addDays(endDate, 1)),
    };
  }

  /** Of the invoices due in the window, how much of the amount is paid. */
  private async collectionRate(
    companyId: string,
    startDate: string,
    endDate: string,
  ): Promise<{ dueCents: number; paidCents: number; rate: number | null }> {
    const dueDate = {
      gte: new Date(`${startDate}T00:00:00Z`),
      lt: new Date(`${addDays(endDate, 1)}T00:00:00Z`),
    };
    const rows = await this.prisma.invoice.groupBy({
      by: ['status'],
      where: { companyId, status: { in: ['PENDING', 'PAID'] }, dueDate },
      _sum: { originalAmount: true },
    });
    const dueCents = rows.reduce(
      (total, row) => total + toCents(row._sum.originalAmount),
      0,
    );
    const paidCents = toCents(
      rows.find((row) => row.status === 'PAID')?._sum.originalAmount,
    );
    return {
      dueCents,
      paidCents,
      rate:
        dueCents > 0 ? Math.round((paidCents / dueCents) * 1000) / 10 : null,
    };
  }
}
