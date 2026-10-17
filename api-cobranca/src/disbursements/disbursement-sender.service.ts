import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DisbursementItem } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DisbursementSettingsService } from './disbursement-settings.service';
import {
  DisbursementAccount,
  EfiDisbursementClient,
  SendOutcome,
} from './efi-disbursement.client';
import {
  DISBURSEMENT_REASONS,
  insufficientBalanceReason,
} from './disbursement-reasons';

const ITEMS_PER_TICK = 25;
const RATE_LIMIT_PAUSE_MS = 60_000;
// A claimed send without a recorded result may have reached Efí.
const SENDING_LOST_AFTER_MS = 2 * 60_000;
const CHECK_EVERY_MS = 60_000;
// The webhook is the fast path; a send still processing this long is checked by its id.
const IN_PROCESSING_CHECK_AFTER_MS = 10 * 60_000;

/**
 * Sends the Pix of approved batches one by one, from the account frozen at the request.
 * Nothing is resent blindly: a result that may have reached Efí is checked by its send id.
 */
@Injectable()
export class DisbursementSenderService {
  private readonly logger = new Logger(DisbursementSenderService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: DisbursementSettingsService,
    private readonly client: EfiDisbursementClient,
  ) {}

  async sendApproved(now = new Date()): Promise<void> {
    const batches = await this.prisma.disbursementBatch.findMany({
      where: {
        status: 'PROCESSING',
        OR: [{ sendPausedUntil: null }, { sendPausedUntil: { lte: now } }],
        items: { some: { status: 'PENDING' } },
      },
      orderBy: { updatedAt: 'asc' },
      take: 10,
      select: { id: true },
    });
    for (const { id } of batches)
      await this.sendBatch(id).catch(() =>
        this.logger.warn(`Envio de lote pendente: ${id}`),
      );
  }

  async sendBatch(batchId: string): Promise<void> {
    const batch = await this.prisma.disbursementBatch.findUniqueOrThrow({
      where: { id: batchId },
      select: {
        id: true,
        companyId: true,
        status: true,
        reference: true,
        issuerIdentityId: true,
        company: {
          select: {
            activeFinancialProfile: { select: { issuerIdentityId: true } },
          },
        },
      },
    });
    if (batch.status !== 'PROCESSING') return;
    if (!(await this.settings.current(batch.companyId))?.enabled) return;
    if (
      !batch.issuerIdentityId ||
      batch.company.activeFinancialProfile?.issuerIdentityId !==
        batch.issuerIdentityId
    )
      return this.failPending(
        batch.id,
        'ISSUER_CHANGED',
        DISBURSEMENT_REASONS.ISSUER_CHANGED,
      );
    let account: DisbursementAccount;
    try {
      account = await this.client.account(
        batch.issuerIdentityId,
        batch.companyId,
      );
    } catch (error) {
      if (error instanceof ConflictException)
        return this.failPending(
          batch.id,
          'ACCOUNT_UNAVAILABLE',
          DISBURSEMENT_REASONS.ACCOUNT_UNAVAILABLE,
        );
      throw error;
    }
    if (!(await this.hasBalance(batch.id, account))) return;
    const pending = await this.prisma.disbursementItem.findMany({
      where: { batchId: batch.id, status: 'PENDING' },
      orderBy: [{ recipientName: 'asc' }, { id: 'asc' }],
      take: ITEMS_PER_TICK,
    });
    for (const item of pending) {
      // Turning the feature off between two items stops the next ones.
      if (!(await this.settings.current(batch.companyId))?.enabled) return;
      const claimed = await this.prisma.disbursementItem.updateMany({
        where: { id: item.id, status: 'PENDING' },
        data: { status: 'SENDING', sendingAt: new Date() },
      });
      if (!claimed.count) continue;
      let outcome: SendOutcome;
      try {
        outcome = await this.client.send(account, {
          ...item,
          reference: batch.reference,
        });
      } catch {
        outcome = { kind: 'UNCERTAIN' };
      }
      if (outcome.kind === 'RATE_LIMITED') {
        await this.prisma.disbursementItem.updateMany({
          where: { id: item.id, status: 'SENDING' },
          data: { status: 'PENDING', sendingAt: null },
        });
        await this.prisma.disbursementBatch.update({
          where: { id: batch.id },
          data: { sendPausedUntil: new Date(Date.now() + RATE_LIMIT_PAUSE_MS) },
        });
        return;
      }
      await this.record(item, outcome);
    }
  }

  /** Results of sends that may have reached Efí without a recorded answer. */
  async reconcile(now = new Date()): Promise<void> {
    await this.prisma.disbursementItem.updateMany({
      where: {
        status: 'SENDING',
        sendingAt: { lt: new Date(now.getTime() - SENDING_LOST_AFTER_MS) },
      },
      data: { status: 'UNCERTAIN' },
    });
    const checkBefore = new Date(now.getTime() - CHECK_EVERY_MS);
    const items = await this.prisma.disbursementItem.findMany({
      where: {
        OR: [
          { status: 'UNCERTAIN' },
          {
            status: 'IN_PROCESSING',
            sentAt: {
              lt: new Date(now.getTime() - IN_PROCESSING_CHECK_AFTER_MS),
            },
          },
        ],
        AND: [
          {
            OR: [
              { lastCheckedAt: null },
              { lastCheckedAt: { lt: checkBefore } },
            ],
          },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: 50,
      select: { id: true },
    });
    for (const { id } of items)
      await this.check(id).catch(() =>
        this.logger.warn(`Verificação de envio pendente: ${id}`),
      );
  }

  /** Asks Efí for one send by its id; only a provider answer changes the item. */
  async check(itemId: string): Promise<void> {
    const item = await this.prisma.disbursementItem.findUniqueOrThrow({
      where: { id: itemId },
      include: { batch: { select: { issuerIdentityId: true } } },
    });
    if (item.status !== 'UNCERTAIN' && item.status !== 'IN_PROCESSING') return;
    await this.prisma.disbursementItem.update({
      where: { id: itemId },
      data: { lastCheckedAt: new Date() },
    });
    if (!item.batch.issuerIdentityId) return;
    const account = await this.client.account(
      item.batch.issuerIdentityId,
      item.companyId,
    );
    const found = await this.client.status(account, item.idEnvio);
    // Not found yet: it stays under verification; never taken as a failure.
    if (found.kind === 'NOT_FOUND') return;
    const from = { id: itemId, status: item.status };
    if (found.status === 'REALIZADO')
      await this.prisma.disbursementItem.updateMany({
        where: from,
        data: {
          status: 'PAID',
          e2eId: found.e2eId,
          settledAt: found.settledAt ?? new Date(),
        },
      });
    else if (found.status === 'NAO_REALIZADO')
      await this.prisma.disbursementItem.updateMany({
        where: from,
        data: {
          status: 'FAILED',
          e2eId: found.e2eId,
          failureCode: 'NAO_REALIZADO',
          failureReason: DISBURSEMENT_REASONS.NOT_REALIZED_UNKNOWN,
        },
      });
    else if (item.status === 'UNCERTAIN')
      await this.prisma.disbursementItem.updateMany({
        where: from,
        data: {
          status: 'IN_PROCESSING',
          e2eId: found.e2eId,
          sentAt: new Date(),
        },
      });
  }

  /** Items whose result is still being confirmed with Efí, for the platform admin. */
  underVerification(companyId: string) {
    return this.prisma.disbursementItem.findMany({
      where: { companyId, status: { in: ['UNCERTAIN', 'SENDING'] } },
      orderBy: { updatedAt: 'asc' },
      take: 100,
      select: {
        id: true,
        batchId: true,
        recipientName: true,
        amountCents: true,
        status: true,
        idEnvio: true,
        sendingAt: true,
        lastCheckedAt: true,
      },
    });
  }

  /** Admin "check at Efí": asks by the send id now; it never resends nor marks a failure. */
  async adminCheck(companyId: string, itemId: string) {
    const item = await this.prisma.disbursementItem.findFirst({
      where: { id: itemId, companyId },
      select: { id: true },
    });
    if (!item) throw new NotFoundException('Pagamento não encontrado.');
    await this.check(itemId);
    return this.prisma.disbursementItem.findUniqueOrThrow({
      where: { id: itemId },
      select: {
        id: true,
        status: true,
        failureReason: true,
        lastCheckedAt: true,
      },
    });
  }

  /** PDF receipt of a paid item of this company (production only; homologation refuses it). */
  async receipt(companyId: string, itemId: string): Promise<Buffer> {
    const item = await this.prisma.disbursementItem.findFirst({
      where: { id: itemId, companyId },
      include: { batch: { select: { issuerIdentityId: true } } },
    });
    if (!item) throw new NotFoundException('Pagamento não encontrado.');
    if (item.status !== 'PAID' || !item.batch.issuerIdentityId)
      throw new ConflictException({
        code: 'RECEIPT_UNAVAILABLE',
        message: 'O comprovante só existe para pagamentos concluídos.',
      });
    const account = await this.client.account(
      item.batch.issuerIdentityId,
      companyId,
    );
    try {
      return await this.client.receipt(account, item.idEnvio);
    } catch {
      throw new ConflictException({
        code: 'RECEIPT_UNAVAILABLE',
        message:
          'A Efí não disponibilizou o comprovante agora. Tente mais tarde.',
      });
    }
  }

  /**
   * Before the first send, the balance must cover everything still to send: a partial
   * batch would choose arbitrarily who gets paid. Homologation always reports zero.
   */
  private async hasBalance(
    batchId: string,
    account: DisbursementAccount,
  ): Promise<boolean> {
    if (account.environment !== 'PRODUCTION') return true;
    const started = await this.prisma.disbursementItem.count({
      where: { batchId, status: { notIn: ['PENDING', 'CANCELED'] } },
    });
    if (started) return true;
    const needed = await this.prisma.disbursementItem.aggregate({
      where: { batchId, status: 'PENDING' },
      _sum: { amountCents: true },
    });
    const neededCents = needed._sum.amountCents ?? 0;
    const balance = await this.client.balanceCents(account);
    if (balance >= neededCents) return true;
    await this.failPending(
      batchId,
      'INSUFFICIENT_BALANCE',
      insufficientBalanceReason(balance, neededCents),
    );
    return false;
  }

  private async failPending(batchId: string, code: string, reason: string) {
    await this.prisma.disbursementItem.updateMany({
      where: { batchId, status: 'PENDING' },
      data: { status: 'FAILED', failureCode: code, failureReason: reason },
    });
  }

  private async record(item: DisbursementItem, outcome: SendOutcome) {
    const where = { id: item.id, status: 'SENDING' as const };
    const now = new Date();
    switch (outcome.kind) {
      case 'IN_PROCESSING':
        await this.prisma.disbursementItem.updateMany({
          where,
          data: { status: 'IN_PROCESSING', e2eId: outcome.e2eId, sentAt: now },
        });
        return;
      case 'PAID':
        await this.prisma.disbursementItem.updateMany({
          where,
          data: {
            status: 'PAID',
            e2eId: outcome.e2eId,
            sentAt: now,
            settledAt: now,
          },
        });
        return;
      case 'REFUSED':
        await this.prisma.disbursementItem.updateMany({
          where,
          data: {
            status: 'FAILED',
            failureCode: outcome.code,
            failureReason: outcome.reason,
          },
        });
        return;
      default:
        // DUPLICATE or UNCERTAIN: Efí may have it; the check by send id decides.
        await this.prisma.disbursementItem.updateMany({
          where,
          data: { status: 'UNCERTAIN' },
        });
    }
  }
}
