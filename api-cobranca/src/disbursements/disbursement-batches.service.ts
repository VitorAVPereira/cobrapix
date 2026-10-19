import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DisbursementRecipient, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { DisbursementSettingsService } from './disbursement-settings.service';
import {
  CreateDisbursementBatchDto,
  DisbursementBatchItemDto,
  DisbursementBatchesQueryDto,
  DisbursementRepeatDto,
  ScheduleDisbursementBatchDto,
  UpdateDisbursementBatchDto,
} from './dto/disbursement-batch.dto';
import { dateOnly, parsePaymentDate, toDbDate } from './disbursement-schedule';

type Tx = Prisma.TransactionClient;
const MAX_TOTAL_CENTS = 2147483647;
const OPEN_STATUSES: string[] = [
  'DRAFT',
  'SCHEDULED',
  'AWAITING_APPROVAL',
  'PROCESSING',
];
// Nothing has been requested yet: the company may still change or cancel it.
const EDITABLE_STATUSES: string[] = ['DRAFT', 'SCHEDULED'];
// Batches that paid nothing; only after one of these may the same failures be retried again.
const UNPAID_FINAL_STATUSES = ['CANCELED', 'EXPIRED', 'REJECTED'] as const;

const ITEM_SELECT = {
  id: true,
  recipientId: true,
  recipientName: true,
  documentType: true,
  document: true,
  pixKey: true,
  bankIspb: true,
  bankAgency: true,
  bankAccount: true,
  bankAccountType: true,
  amountCents: true,
  status: true,
  failureCode: true,
  failureReason: true,
  sentAt: true,
  settledAt: true,
} satisfies Prisma.DisbursementItemSelect;

const BATCH_SELECT = {
  id: true,
  reference: true,
  status: true,
  totalCents: true,
  itemCount: true,
  retryOfBatchId: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  scheduledFor: true,
  scheduleProblem: true,
  scheduleOccurrence: true,
  schedule: {
    select: {
      id: true,
      unit: true,
      every: true,
      endsOn: true,
      maxOccurrences: true,
      occurrencesCreated: true,
      status: true,
      version: true,
    },
  },
} satisfies Prisma.DisbursementBatchSelect;

type BatchRow = Prisma.DisbursementBatchGetPayload<{
  select: typeof BATCH_SELECT;
}>;

/** Dates of the screen are São Paulo calendar dates, not instants. */
function batchView<T extends BatchRow>(batch: T) {
  return {
    ...batch,
    scheduledFor: batch.scheduledFor ? dateOnly(batch.scheduledFor) : null,
    schedule: batch.schedule
      ? {
          ...batch.schedule,
          endsOn: batch.schedule.endsOn
            ? dateOnly(batch.schedule.endsOn)
            : null,
        }
      : null,
  };
}

export interface HashedItem {
  documentType: string;
  document: string;
  pixKey: string | null;
  bankIspb: string | null;
  bankAgency: string | null;
  bankAccount: string | null;
  bankAccountType: string | null;
  amountCents: number;
}

/**
 * What the approver authorizes: reference, paying account, total and each destination
 * with its amount. Any change produces another hash, so an old approval cannot pay it.
 */
export function batchContentHash(input: {
  reference: string;
  issuerIdentityId: string;
  items: HashedItem[];
}): string {
  const items = input.items
    .map((item) => [
      item.documentType,
      item.document,
      item.pixKey,
      item.bankIspb,
      item.bankAgency,
      item.bankAccount,
      item.bankAccountType,
      item.amountCents,
    ])
    .sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  const totalCents = input.items.reduce(
    (sum, item) => sum + item.amountCents,
    0,
  );
  return createHash('sha256')
    .update(
      JSON.stringify([
        input.reference,
        input.issuerIdentityId,
        totalCents,
        items,
      ]),
    )
    .digest('hex');
}

/** The collaborator as registered now; later edits never move money already approved. */
export function itemSnapshot(recipient: DisbursementRecipient) {
  return {
    recipientId: recipient.id,
    recipientName: recipient.name,
    documentType: recipient.documentType,
    document: recipient.document,
    pixKey: recipient.pixKey,
    bankIspb: recipient.bankIspb,
    bankAgency: recipient.bankAgency,
    bankAccount: recipient.bankAccount,
    bankAccountType: recipient.bankAccountType,
  };
}

function conflict(code: string, message: string): never {
  throw new ConflictException({ code, message });
}

@Injectable()
export class DisbursementBatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: DisbursementSettingsService,
  ) {}

  async list(companyId: string, query: DisbursementBatchesQueryDto) {
    await this.settings.assertEnabled(companyId);
    const where: Prisma.DisbursementBatchWhereInput = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.disbursementBatch.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: BATCH_SELECT,
      }),
      this.prisma.disbursementBatch.count({ where }),
    ]);
    return {
      items: items.map(batchView),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(companyId: string, id: string) {
    await this.settings.assertEnabled(companyId);
    const batch = await this.prisma.disbursementBatch.findFirst({
      where: { id, companyId },
      select: {
        ...BATCH_SELECT,
        items: { select: ITEM_SELECT, orderBy: { recipientName: 'asc' } },
        approvals: {
          select: {
            requestNumber: true,
            state: true,
            expiresAt: true,
            decidedAt: true,
          },
          orderBy: { requestNumber: 'desc' },
          take: 1,
        },
      },
    });
    if (!batch) throw new NotFoundException('Lote não encontrado.');
    const { approvals, ...rest } = batch;
    return { ...batchView(rest), approval: approvals[0] ?? null };
  }

  /**
   * Without a date the batch is a draft (as before). With a date it is scheduled; for
   * today the caller requests the approval right away. A repetition starts with it.
   */
  async create(
    companyId: string,
    userId: string,
    dto: CreateDisbursementBatchDto,
    now = new Date(),
  ) {
    await this.settings.assertEnabled(companyId);
    const scheduledFor =
      dto.scheduledFor !== undefined
        ? parsePaymentDate(dto.scheduledFor, now)
        : null;
    if (dto.repeat && !scheduledFor)
      throw new BadRequestException({
        code: 'PAYMENT_DATE_REQUIRED',
        message: 'Informe a data do primeiro pagamento para repetir.',
      });
    const id = await this.prisma.$transaction(async (tx) => {
      const items = await this.buildItems(tx, companyId, dto.items);
      const schedule =
        dto.repeat && scheduledFor
          ? await this.createSchedule(
              tx,
              companyId,
              userId,
              dto,
              dto.repeat,
              scheduledFor,
            )
          : null;
      const batch = await tx.disbursementBatch.create({
        data: {
          companyId,
          reference: dto.reference.trim(),
          createdByUserId: userId,
          ...this.totals(items),
          ...(scheduledFor
            ? { status: 'SCHEDULED', scheduledFor: toDbDate(scheduledFor) }
            : {}),
          ...(schedule
            ? { scheduleId: schedule.id, scheduleOccurrence: 1 }
            : {}),
        },
      });
      await tx.disbursementItem.createMany({
        data: items.map((item) => ({ ...item, batchId: batch.id, companyId })),
      });
      return batch.id;
    });
    return this.get(companyId, id);
  }

  /** Only a draft is edited; its items are replaced as a whole. */
  async update(
    companyId: string,
    id: string,
    dto: UpdateDisbursementBatchDto,
    now = new Date(),
  ) {
    await this.settings.assertEnabled(companyId);
    if (dto.repeat)
      throw new BadRequestException({
        code: 'REPEAT_ON_CREATE_ONLY',
        message: 'A repetição é definida ao criar o pagamento.',
      });
    const scheduledFor =
      dto.scheduledFor !== undefined
        ? parsePaymentDate(dto.scheduledFor, now)
        : null;
    await this.prisma.$transaction(async (tx) => {
      const batch = await this.lock(tx, companyId, id);
      if (!EDITABLE_STATUSES.includes(batch.status))
        conflict(
          'BATCH_NOT_EDITABLE',
          'Só é possível alterar um pagamento que ainda não pediu aprovação.',
        );
      if (batch.version !== dto.expectedVersion)
        conflict(
          'VERSION_CHANGED',
          'O lote foi alterado por outra pessoa. Recarregue os dados.',
        );
      const items = await this.buildItems(tx, companyId, dto.items);
      await tx.disbursementItem.deleteMany({
        where: { batchId: id, companyId },
      });
      await tx.disbursementItem.createMany({
        data: items.map((item) => ({ ...item, batchId: id, companyId })),
      });
      await tx.disbursementBatch.update({
        where: { id },
        data: {
          reference: dto.reference.trim(),
          ...this.totals(items),
          // A date (re)schedules it and clears the problem of a missed date.
          ...(scheduledFor
            ? {
                status: 'SCHEDULED',
                scheduledFor: toDbDate(scheduledFor),
                scheduleProblem: null,
              }
            : {}),
          version: { increment: 1 },
        },
      });
      if (dto.applyToSchedule && batch.scheduleId)
        await this.replaceScheduleItems(tx, companyId, batch.scheduleId, items);
    });
    return this.get(companyId, id);
  }

  /** Draft to scheduled; for today the caller requests the approval right away. */
  async schedule(
    companyId: string,
    id: string,
    dto: ScheduleDisbursementBatchDto,
    now = new Date(),
  ) {
    await this.settings.assertEnabled(companyId);
    const scheduledFor = parsePaymentDate(dto.scheduledFor, now);
    await this.prisma.$transaction(async (tx) => {
      const batch = await this.lock(tx, companyId, id);
      if (!EDITABLE_STATUSES.includes(batch.status))
        conflict(
          'BATCH_NOT_EDITABLE',
          'Só é possível agendar um pagamento que ainda não pediu aprovação.',
        );
      if (batch.version !== dto.expectedVersion)
        conflict(
          'VERSION_CHANGED',
          'O pagamento foi alterado por outra pessoa. Recarregue os dados.',
        );
      await tx.disbursementBatch.update({
        where: { id },
        data: {
          status: 'SCHEDULED',
          scheduledFor: toDbDate(scheduledFor),
          scheduleProblem: null,
          version: { increment: 1 },
        },
      });
    });
    return this.get(companyId, id);
  }

  /** Ends a repetition; its occurrence still waiting for the date is canceled too. */
  async endSchedule(
    companyId: string,
    scheduleId: string,
    expectedVersion: number,
  ) {
    await this.settings.assertEnabled(companyId);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "DisbursementSchedule" WHERE id=${scheduleId} AND "companyId"=${companyId} FOR UPDATE`;
      const schedule = await tx.disbursementSchedule.findFirst({
        where: { id: scheduleId, companyId },
        select: { status: true, version: true },
      });
      if (!schedule) throw new NotFoundException('Repetição não encontrada.');
      if (schedule.version !== expectedVersion)
        conflict(
          'VERSION_CHANGED',
          'A repetição foi alterada por outra pessoa. Recarregue os dados.',
        );
      if (schedule.status === 'ENDED') return;
      await tx.disbursementSchedule.update({
        where: { id: scheduleId },
        data: {
          status: 'ENDED',
          endedAt: new Date(),
          version: { increment: 1 },
        },
      });
      const upcoming = await tx.disbursementBatch.findMany({
        where: { companyId, scheduleId, status: 'SCHEDULED' },
        select: { id: true },
      });
      for (const { id } of upcoming) {
        await this.lock(tx, companyId, id);
        await this.cancelUnrequested(tx, companyId, id);
      }
    });
    return { id: scheduleId, status: 'ENDED' as const };
  }

  /** Nothing has been sent yet; a batch being paid is never canceled by the company. */
  async cancel(companyId: string, id: string) {
    await this.settings.assertEnabled(companyId);
    await this.prisma.$transaction(async (tx) => {
      const batch = await this.lock(tx, companyId, id);
      if (
        batch.status !== 'DRAFT' &&
        batch.status !== 'SCHEDULED' &&
        batch.status !== 'AWAITING_APPROVAL'
      )
        conflict(
          'BATCH_NOT_CANCELABLE',
          'Pagamento em envio ou encerrado não pode ser cancelado.',
        );
      await this.cancelUnrequested(tx, companyId, id);
    });
    return this.get(companyId, id);
  }

  private async cancelUnrequested(tx: Tx, companyId: string, id: string) {
    await tx.disbursementItem.updateMany({
      where: { batchId: id, companyId, status: 'PENDING' },
      data: { status: 'CANCELED' },
    });
    await tx.disbursementApproval.updateMany({
      where: { batchId: id, companyId, state: 'AWAITING' },
      data: { state: 'INVALIDATED' },
    });
    await tx.disbursementBatch.update({
      where: { id },
      data: { status: 'CANCELED', version: { increment: 1 } },
    });
  }

  private async createSchedule(
    tx: Tx,
    companyId: string,
    userId: string,
    dto: CreateDisbursementBatchDto,
    repeat: DisbursementRepeatDto,
    firstDate: string,
  ) {
    if (repeat.endsOn !== undefined && repeat.occurrences !== undefined)
      throw new BadRequestException({
        code: 'REPEAT_END_AMBIGUOUS',
        message:
          'Escolha terminar em uma data ou depois de algumas vezes, não os dois.',
      });
    if (repeat.endsOn !== undefined && repeat.endsOn <= firstDate)
      throw new BadRequestException({
        code: 'REPEAT_END_BEFORE_START',
        message:
          'A data final da repetição deve ser depois do primeiro pagamento.',
      });
    const schedule = await tx.disbursementSchedule.create({
      data: {
        companyId,
        reference: dto.reference.trim(),
        unit: repeat.unit,
        every: repeat.every,
        firstDate: toDbDate(firstDate),
        endsOn: repeat.endsOn ? toDbDate(repeat.endsOn) : null,
        maxOccurrences: repeat.occurrences ?? null,
        occurrencesCreated: 1,
        createdByUserId: userId,
      },
      select: { id: true },
    });
    await tx.disbursementScheduleItem.createMany({
      data: dto.items.map((item) => ({
        scheduleId: schedule.id,
        companyId,
        recipientId: item.recipientId,
        amountCents: item.amountCents,
      })),
    });
    return schedule;
  }

  /** "Apply to the next ones": the next repetitions copy these amounts. */
  private async replaceScheduleItems(
    tx: Tx,
    companyId: string,
    scheduleId: string,
    items: { recipientId: string; amountCents: number }[],
  ) {
    await tx.disbursementScheduleItem.deleteMany({
      where: { scheduleId, companyId },
    });
    await tx.disbursementScheduleItem.createMany({
      data: items.map((item) => ({
        scheduleId,
        companyId,
        recipientId: item.recipientId,
        amountCents: item.amountCents,
      })),
    });
    await tx.disbursementSchedule.update({
      where: { id: scheduleId },
      data: { version: { increment: 1 } },
    });
  }

  /**
   * New draft with the failed items, using each collaborator's current data. Inactive
   * collaborators are left out. An open retry of the same batch is returned (double click);
   * a retry that may have paid blocks another one, which would pay the same people twice.
   */
  async retryFailed(companyId: string, userId: string, id: string) {
    await this.settings.assertEnabled(companyId);
    const result = await this.prisma.$transaction(async (tx) => {
      const source = await this.lock(tx, companyId, id);
      if (source.status !== 'COMPLETED_WITH_FAILURES')
        conflict(
          'BATCH_HAS_NO_FAILURES',
          'Só um lote concluído com falhas pode gerar um novo lote.',
        );
      const previous = await tx.disbursementBatch.findFirst({
        where: {
          companyId,
          retryOfBatchId: id,
          status: { notIn: [...UNPAID_FINAL_STATUSES] },
        },
        select: { id: true, status: true },
      });
      if (previous && OPEN_STATUSES.includes(previous.status))
        return { id: previous.id, skippedInactive: 0 };
      if (previous)
        conflict(
          'BATCH_ALREADY_RETRIED',
          'As falhas deste lote já foram enviadas em outro lote. Use o lote mais recente.',
        );
      const failed = await tx.disbursementItem.findMany({
        where: { batchId: id, companyId, status: 'FAILED' },
        select: { amountCents: true, recipient: true },
      });
      const active = failed.filter((item) => item.recipient.active);
      if (!active.length)
        conflict(
          'BATCH_HAS_NO_FAILURES',
          'Não há itens com falha de colaboradores ativos para pagar novamente.',
        );
      const items = active.map((item) =>
        this.item(item.recipient, item.amountCents),
      );
      const batch = await tx.disbursementBatch.create({
        data: {
          companyId,
          reference: `${source.reference} (novo envio)`.slice(0, 80),
          createdByUserId: userId,
          retryOfBatchId: id,
          ...this.totals(items),
        },
      });
      await tx.disbursementItem.createMany({
        data: items.map((item) => ({ ...item, batchId: batch.id, companyId })),
      });
      return { id: batch.id, skippedInactive: failed.length - active.length };
    });
    return {
      ...(await this.get(companyId, result.id)),
      skippedInactive: result.skippedInactive,
    };
  }

  private async lock(tx: Tx, companyId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM "DisbursementBatch" WHERE id=${id} AND "companyId"=${companyId} FOR UPDATE`;
    const batch = await tx.disbursementBatch.findFirst({
      where: { id, companyId },
      select: {
        status: true,
        version: true,
        reference: true,
        scheduleId: true,
      },
    });
    if (!batch) throw new NotFoundException('Lote não encontrado.');
    return batch;
  }

  private async buildItems(
    tx: Tx,
    companyId: string,
    inputs: DisbursementBatchItemDto[],
  ) {
    const ids = inputs.map((input) => input.recipientId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException({
        code: 'RECIPIENT_REPEATED',
        message: 'Um colaborador aparece mais de uma vez no lote.',
      });
    const total = inputs.reduce((sum, input) => sum + input.amountCents, 0);
    if (total > MAX_TOTAL_CENTS)
      throw new BadRequestException({
        code: 'BATCH_TOTAL_TOO_HIGH',
        message:
          'O total do lote passa do limite permitido. Divida em mais lotes.',
      });
    const recipients = new Map(
      (
        await tx.disbursementRecipient.findMany({
          where: { companyId, id: { in: ids } },
        })
      ).map((recipient) => [recipient.id, recipient]),
    );
    return inputs.map((input) => {
      const recipient = recipients.get(input.recipientId);
      if (!recipient)
        throw new NotFoundException('Colaborador não encontrado.');
      if (!recipient.active)
        conflict(
          'RECIPIENT_INACTIVE',
          `${recipient.name} está desativado e não pode entrar em um lote.`,
        );
      return this.item(recipient, input.amountCents);
    });
  }

  private item(recipient: DisbursementRecipient, amountCents: number) {
    const id = randomUUID();
    // Our Efí idempotency key: the item id without hyphens (32 characters).
    return {
      id,
      idEnvio: id.replace(/-/g, ''),
      amountCents,
      ...itemSnapshot(recipient),
    };
  }

  private totals(items: { amountCents: number }[]) {
    return {
      totalCents: items.reduce((sum, item) => sum + item.amountCents, 0),
      itemCount: items.length,
    };
  }
}
