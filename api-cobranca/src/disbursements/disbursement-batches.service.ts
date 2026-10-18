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
  UpdateDisbursementBatchDto,
} from './dto/disbursement-batch.dto';

type Tx = Prisma.TransactionClient;
const MAX_TOTAL_CENTS = 2147483647;
const OPEN_STATUSES: string[] = ['DRAFT', 'AWAITING_APPROVAL', 'PROCESSING'];
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
} satisfies Prisma.DisbursementBatchSelect;

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
    return { items, total, page: query.page, pageSize: query.pageSize };
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
    return { ...rest, approval: approvals[0] ?? null };
  }

  async create(
    companyId: string,
    userId: string,
    dto: CreateDisbursementBatchDto,
  ) {
    await this.settings.assertEnabled(companyId);
    const id = await this.prisma.$transaction(async (tx) => {
      const items = await this.buildItems(tx, companyId, dto.items);
      const batch = await tx.disbursementBatch.create({
        data: {
          companyId,
          reference: dto.reference.trim(),
          createdByUserId: userId,
          ...this.totals(items),
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
  async update(companyId: string, id: string, dto: UpdateDisbursementBatchDto) {
    await this.settings.assertEnabled(companyId);
    await this.prisma.$transaction(async (tx) => {
      const batch = await this.lock(tx, companyId, id);
      if (batch.status !== 'DRAFT')
        conflict(
          'BATCH_NOT_EDITABLE',
          'Só é possível alterar um lote em rascunho.',
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
          version: { increment: 1 },
        },
      });
    });
    return this.get(companyId, id);
  }

  /** Nothing has been sent yet; a batch being paid is never canceled by the company. */
  async cancel(companyId: string, id: string) {
    await this.settings.assertEnabled(companyId);
    await this.prisma.$transaction(async (tx) => {
      const batch = await this.lock(tx, companyId, id);
      if (batch.status !== 'DRAFT' && batch.status !== 'AWAITING_APPROVAL')
        conflict(
          'BATCH_NOT_CANCELABLE',
          'Lote em envio ou encerrado não pode ser cancelado.',
        );
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
    });
    return this.get(companyId, id);
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
      select: { status: true, version: true, reference: true },
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
