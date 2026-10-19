import { HttpException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { DisbursementApprovalService } from './disbursement-approval.service';
import { itemSnapshot } from './disbursement-batches.service';
import {
  dateOnly,
  occurrenceDate,
  requestTimeReached,
  saoPauloDate,
  toDbDate,
  withinSchedule,
} from './disbursement-schedule';

const MISSED_DATE =
  'A data agendada passou sem o envio do pedido de aprovação. Escolha uma nova data.';
const NOT_SENT =
  'Não foi possível enviar o pedido de aprovação na data. Revise o pagamento e agende de novo.';

function problemOf(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === 'object' && response && 'message' in response) {
      const message = (response as { message: unknown }).message;
      if (typeof message === 'string') return message;
    }
  }
  return NOT_SENT;
}

function formatDate(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

/**
 * Scheduled payments: on their date, at 08:00 (São Paulo), the approval request goes to the
 * approver; a request that cannot go out returns the payment to draft with the reason.
 * Repetitions always keep one occurrence ahead.
 */
@Injectable()
export class DisbursementSchedulerService {
  private readonly logger = new Logger(DisbursementSchedulerService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: DisbursementApprovalService,
  ) {}

  /** After saving: a payment scheduled for today is requested right away. */
  async requestIfToday(
    companyId: string,
    batchId: string,
    now = new Date(),
  ): Promise<void> {
    const batch = await this.prisma.disbursementBatch.findFirst({
      where: { id: batchId, companyId, status: 'SCHEDULED' },
      select: { scheduledFor: true, createdByUserId: true },
    });
    if (
      !batch?.scheduledFor ||
      dateOnly(batch.scheduledFor) !== saoPauloDate(now)
    )
      return;
    try {
      await this.approvals.request(
        companyId,
        batch.createdByUserId,
        batchId,
        null,
        now,
      );
    } catch (error) {
      await this.toDraft(companyId, batchId, problemOf(error));
      throw error;
    }
  }

  /** Each tick: scheduled payments whose date and hour arrived. */
  async requestDue(now = new Date()): Promise<void> {
    const today = saoPauloDate(now);
    const due = await this.prisma.disbursementBatch.findMany({
      where: { status: 'SCHEDULED', scheduledFor: { lte: toDbDate(today) } },
      orderBy: { scheduledFor: 'asc' },
      take: 50,
      select: {
        id: true,
        companyId: true,
        scheduledFor: true,
        createdByUserId: true,
      },
    });
    for (const batch of due) {
      const date = dateOnly(batch.scheduledFor!);
      // Asking on another day would surprise the approver: the company reschedules.
      if (date < today) {
        await this.toDraft(batch.companyId, batch.id, MISSED_DATE);
        continue;
      }
      if (!requestTimeReached(date, now)) continue;
      try {
        await this.approvals.request(
          batch.companyId,
          batch.createdByUserId,
          batch.id,
          null,
          now,
        );
      } catch (error) {
        await this.toDraft(batch.companyId, batch.id, problemOf(error));
      }
    }
  }

  /** Each tick: an active repetition without a scheduled occurrence gets the next one. */
  async createNextOccurrences(now = new Date()): Promise<void> {
    const schedules = await this.prisma.disbursementSchedule.findMany({
      where: {
        status: 'ACTIVE',
        batches: { none: { status: 'SCHEDULED' } },
      },
      take: 50,
      select: { id: true, companyId: true },
    });
    for (const schedule of schedules)
      await this.createNext(schedule.companyId, schedule.id, now).catch(() =>
        this.logger.warn(`DISBURSEMENT_SCHEDULE_NEXT_FAILED ${schedule.id}`),
      );
  }

  private async createNext(
    companyId: string,
    scheduleId: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "DisbursementSchedule" WHERE id=${scheduleId} AND "companyId"=${companyId} FOR UPDATE`;
      const schedule = await tx.disbursementSchedule.findFirstOrThrow({
        where: { id: scheduleId, companyId },
        include: { items: { include: { recipient: true } } },
      });
      if (schedule.status !== 'ACTIVE') return;
      const waiting = await tx.disbursementBatch.count({
        where: { companyId, scheduleId, status: 'SCHEDULED' },
      });
      if (waiting) return;
      const n = schedule.occurrencesCreated + 1;
      const date = occurrenceDate(
        dateOnly(schedule.firstDate),
        schedule.unit,
        schedule.every,
        n,
      );
      const ended =
        !schedule.items.length ||
        !withinSchedule(
          {
            endsOn: schedule.endsOn ? dateOnly(schedule.endsOn) : null,
            maxOccurrences: schedule.maxOccurrences,
          },
          n,
          date,
        );
      if (ended) {
        await tx.disbursementSchedule.update({
          where: { id: scheduleId },
          data: { status: 'ENDED', endedAt: now, version: { increment: 1 } },
        });
        return;
      }
      // An inactive collaborator stays in: on the date the request explains it, instead of
      // someone silently not being paid.
      const items = schedule.items.map((item) => {
        const id = randomUUID();
        return {
          id,
          idEnvio: id.replace(/-/g, ''),
          amountCents: item.amountCents,
          ...itemSnapshot(item.recipient),
        };
      });
      const batch = await tx.disbursementBatch.create({
        data: {
          companyId,
          reference: `${schedule.reference} (${formatDate(date)})`.slice(0, 80),
          createdByUserId: schedule.createdByUserId,
          status: 'SCHEDULED',
          scheduledFor: toDbDate(date),
          scheduleId,
          scheduleOccurrence: n,
          totalCents: items.reduce((sum, item) => sum + item.amountCents, 0),
          itemCount: items.length,
        },
      });
      await tx.disbursementItem.createMany({
        data: items.map((item) => ({ ...item, batchId: batch.id, companyId })),
      });
      await tx.disbursementSchedule.update({
        where: { id: scheduleId },
        data: { occurrencesCreated: n },
      });
    });
  }

  private async toDraft(
    companyId: string,
    batchId: string,
    problem: string,
  ): Promise<void> {
    await this.prisma.disbursementBatch.updateMany({
      where: { id: batchId, companyId, status: { in: ['SCHEDULED', 'DRAFT'] } },
      data: {
        status: 'DRAFT',
        scheduleProblem: problem,
        version: { increment: 1 },
      },
    });
  }
}
