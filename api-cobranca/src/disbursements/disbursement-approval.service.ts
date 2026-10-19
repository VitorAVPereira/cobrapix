import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DisbursementApproval, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { FinancialEligibilityService } from '../financial-activation/financial-eligibility.service';
import { TemplatePolicyService } from '../templates/template-policy.service';
import { TemplateSendPreparerService } from '../templates/template-send-preparer.service';
import { decisionLabels, formatAmount } from '../templates/template-renderer';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { messageRecipient } from '../communications/message-context';
import { DisbursementSettingsService } from './disbursement-settings.service';
import {
  DisbursementBatchesService,
  batchContentHash,
  itemSnapshot,
} from './disbursement-batches.service';
import { endOfSaoPauloDay, saoPauloDate } from './disbursement-schedule';

type Tx = Prisma.TransactionClient;
// A tap sent just before the deadline may reach the webhook a little later.
const EXPIRY_GRACE_MS = 2 * 60 * 1000;
// A request whose message was never prepared (process lost mid-request) goes back to draft.
const UNSENT_AFTER_MS = 5 * 60 * 1000;
const ACK_WINDOW_MS = 24 * 60 * 60 * 1000;

interface Tap {
  id: string;
  externalMessageId: string | null;
  conversationId: string;
  approve: boolean;
  at: Date;
}

function conflict(code: string, message: string): never {
  throw new ConflictException({ code, message });
}

/** The approver's number as WhatsApp may report it: with and without the mobile ninth digit. */
export function approverPhoneHashes(phone: string): string[] {
  const variants = [phone];
  if (/^55\d{2}9\d{8}$/.test(phone))
    variants.push(phone.slice(0, 4) + phone.slice(5));
  else if (/^55\d{10}$/.test(phone))
    variants.push(`${phone.slice(0, 4)}9${phone.slice(4)}`);
  return variants.map(
    (value) => messageRecipient({ type: 'PHONE', value }).hash,
  );
}

/**
 * Approval of a batch by the company's approver on WhatsApp. Nothing is paid without a
 * decision recorded once, for the current request, with the batch exactly as requested.
 */
@Injectable()
export class DisbursementApprovalService {
  private readonly logger = new Logger(DisbursementApprovalService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: DisbursementSettingsService,
    private readonly batches: DisbursementBatchesService,
    private readonly eligibility: FinancialEligibilityService,
    private readonly policy: TemplatePolicyService,
    private readonly templateSender: TemplateSendPreparerService,
    private readonly whatsapp: WhatsappService,
    private readonly crypto: PaymentCryptoService,
  ) {}

  /**
   * `expectedVersion` is the company's click on a draft; `null` is the scheduled request of
   * a payment on its date. Either way the approver has until 23:59 of today (São Paulo).
   */
  async request(
    companyId: string,
    userId: string,
    batchId: string,
    expectedVersion: number | null,
    now = new Date(),
  ) {
    await this.settings.assertEnabled(companyId);
    const readiness = await this.settings.readiness(companyId);
    if (!readiness.ready) this.unavailable();
    const profile = await this.eligibility.resolveIssuance(companyId);
    const labels = await this.prisma.$transaction(async (tx) => {
      const decision = await this.policy.resolve(tx, companyId, {
        mode: 'DEFAULT',
        purpose: 'DISBURSEMENT_APPROVAL',
      });
      return decision.allowed
        ? decisionLabels(
            decision.template.parsed,
            decision.template.mapping.decisionButtons,
          )
        : null;
    });
    if (!labels) this.unavailable();
    const approval = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, companyId, batchId);
      const batch = await tx.disbursementBatch.findFirst({
        where: { id: batchId, companyId },
        select: {
          status: true,
          version: true,
          reference: true,
          approvalRequests: true,
        },
      });
      if (!batch) throw new NotFoundException('Lote não encontrado.');
      const scheduled = expectedVersion === null;
      if (batch.status !== (scheduled ? 'SCHEDULED' : 'DRAFT'))
        conflict(
          'BATCH_NOT_DRAFT',
          scheduled
            ? 'O pagamento não está mais agendado.'
            : 'Só um pagamento em rascunho pode ser enviado para aprovação.',
        );
      if (!scheduled && batch.version !== expectedVersion)
        conflict(
          'VERSION_CHANGED',
          'O pagamento foi alterado por outra pessoa. Recarregue os dados.',
        );
      const settings = await this.settings.current(companyId, tx);
      if (!settings?.enabled)
        throw new NotFoundException(
          'Pagamentos a colaboradores não estão disponíveis.',
        );
      const items = await tx.disbursementItem.findMany({
        where: { batchId, companyId },
        select: { id: true, amountCents: true, recipient: true },
      });
      const inactive = items.find((item) => !item.recipient.active);
      if (inactive)
        conflict(
          'RECIPIENT_INACTIVE',
          `${inactive.recipient.name} está desativado. Retire do pagamento ou reative o colaborador.`,
        );
      // The approver authorizes what is registered now; from here on nothing changes.
      const snapshots = items.map((item) => ({
        amountCents: item.amountCents,
        ...itemSnapshot(item.recipient),
      }));
      for (const item of items)
        await tx.disbursementItem.update({
          where: { id: item.id },
          data: itemSnapshot(item.recipient),
        });
      const contentHash = batchContentHash({
        reference: batch.reference,
        issuerIdentityId: profile.issuerIdentityId,
        items: snapshots,
      });
      const requestNumber = batch.approvalRequests + 1;
      const created = await tx.disbursementApproval.create({
        data: {
          batchId,
          companyId,
          requestNumber,
          contentHash,
          totalCents: snapshots.reduce(
            (sum, item) => sum + item.amountCents,
            0,
          ),
          itemCount: snapshots.length,
          settingsVersion: settings.version,
          approverPhoneHash: messageRecipient({
            type: 'PHONE',
            value: settings.approverPhone,
          }).hash,
          approveLabel: labels.approve,
          rejectLabel: labels.reject,
          expiresAt: endOfSaoPauloDay(saoPauloDate(now)),
          requestedByUserId: userId,
        },
      });
      await tx.disbursementBatch.update({
        where: { id: batchId },
        data: {
          status: 'AWAITING_APPROVAL',
          scheduleProblem: null,
          contentHash,
          issuerIdentityId: profile.issuerIdentityId,
          approvalRequests: requestNumber,
          version: { increment: 1 },
        },
      });
      return created;
    });
    await this.send(approval);
    return this.batches.get(companyId, batchId);
  }

  /** Each tick: taps answered, deadlines, lost requests, confirmations and notices. */
  async decideAwaiting(): Promise<void> {
    const awaiting = await this.prisma.disbursementApproval.findMany({
      where: { state: 'AWAITING', intentId: { not: null } },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: { id: true },
    });
    for (const { id } of awaiting)
      await this.decide(id).catch(() =>
        this.logger.warn(`Decisão de pagamento pendente: ${id}`),
      );
  }

  async decide(approvalId: string): Promise<void> {
    const approval = await this.prisma.disbursementApproval.findUniqueOrThrow({
      where: { id: approvalId },
    });
    if (approval.state !== 'AWAITING' || !approval.intentId) return;
    const tap = (await this.taps(approval)).find(
      (candidate) => candidate.at < approval.expiresAt,
    );
    if (!tap) return;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, approval.companyId, approval.batchId);
      const current = await tx.disbursementApproval.findUniqueOrThrow({
        where: { id: approvalId },
      });
      if (current.state !== 'AWAITING') return;
      if (!(await this.stillAsRequested(tx, current))) {
        // Something changed after the request: the tap authorizes nothing.
        this.logger.warn(`Pedido de pagamento divergente: ${approvalId}`);
        await this.close(tx, current, 'INVALIDATED', 'DRAFT');
        return;
      }
      await tx.disbursementApproval.update({
        where: { id: approvalId },
        data: {
          state: tap.approve ? 'APPROVED' : 'REJECTED',
          decidedAt: tap.at,
          decisionMessageId: tap.id,
          decisionExternalMessageId: tap.externalMessageId,
        },
      });
      await tx.disbursementBatch.update({
        where: { id: current.batchId },
        data: {
          status: tap.approve ? 'PROCESSING' : 'REJECTED',
          version: { increment: 1 },
        },
      });
      if (!tap.approve)
        await tx.disbursementItem.updateMany({
          where: {
            batchId: current.batchId,
            companyId: current.companyId,
            status: 'PENDING',
          },
          data: { status: 'CANCELED' },
        });
    });
  }

  async expireOverdue(now = new Date()): Promise<void> {
    const overdue = await this.prisma.disbursementApproval.findMany({
      where: {
        state: 'AWAITING',
        expiresAt: { lte: new Date(now.getTime() - EXPIRY_GRACE_MS) },
      },
      take: 100,
    });
    for (const approval of overdue)
      await this.prisma.$transaction(async (tx) => {
        await this.lock(tx, approval.companyId, approval.batchId);
        await this.close(tx, approval, 'EXPIRED', 'EXPIRED');
      });
  }

  /** Requests whose WhatsApp message was never prepared return to draft. */
  async releaseUnsent(now = new Date()): Promise<void> {
    const lost = await this.prisma.disbursementApproval.findMany({
      where: {
        state: 'AWAITING',
        intentId: null,
        createdAt: { lte: new Date(now.getTime() - UNSENT_AFTER_MS) },
      },
      take: 100,
    });
    for (const approval of lost)
      await this.prisma.$transaction(async (tx) => {
        await this.lock(tx, approval.companyId, approval.batchId);
        await this.close(tx, approval, 'HELD', 'DRAFT');
      });
  }

  /** One free-text reply per request, inside the window the approver's tap opened. */
  async sendAcks(now = new Date()): Promise<void> {
    const since = new Date(now.getTime() - ACK_WINDOW_MS);
    const pending = await this.prisma.disbursementApproval.findMany({
      where: {
        ackSentAt: null,
        intentId: { not: null },
        updatedAt: { gte: since },
        state: { in: ['APPROVED', 'REJECTED', 'EXPIRED', 'INVALIDATED'] },
      },
      take: 100,
      include: { batch: { select: { reference: true } } },
    });
    for (const approval of pending) {
      const taps = await this.taps(approval);
      const tap =
        approval.decisionMessageId !== null
          ? taps.find(
              (candidate) => candidate.id === approval.decisionMessageId,
            )
          : taps[0];
      if (!tap) continue;
      const total = formatAmount(approval.totalCents / 100);
      const content =
        approval.state === 'APPROVED'
          ? `Aprovação registrada. Os ${approval.itemCount} pagamentos do lote ${approval.batch.reference} (total de ${total}) estão sendo enviados por Pix.`
          : approval.state === 'REJECTED'
            ? `Recusa registrada. Nenhum pagamento do lote ${approval.batch.reference} será feito.`
            : 'Este pedido de aprovação não vale mais. Nenhum pagamento foi feito por ele.';
      await this.reply(approval, tap, content).catch(() =>
        this.logger.warn(`Confirmação de pagamento pendente: ${approval.id}`),
      );
    }
  }

  async notifyExpired(): Promise<void> {
    const expired = await this.prisma.disbursementApproval.findMany({
      where: { state: 'EXPIRED', noticeSentAt: null, intentId: { not: null } },
      take: 50,
      select: { id: true, companyId: true },
    });
    for (const approval of expired)
      await this.notice(
        approval,
        'DISBURSEMENT_EXPIRED',
        'disbursement-expired',
      );
  }

  /** Once per approved batch that ended with failed items, with each reason. */
  async notifyFailures(): Promise<void> {
    const failed = await this.prisma.disbursementApproval.findMany({
      where: {
        state: 'APPROVED',
        noticeSentAt: null,
        batch: {
          status: 'COMPLETED_WITH_FAILURES',
          items: { some: { status: 'FAILED' } },
        },
      },
      take: 50,
      select: { id: true, companyId: true },
    });
    for (const approval of failed)
      await this.notice(approval, 'DISBURSEMENT_FAILED', 'disbursement-failed');
  }

  private async notice(
    approval: { id: string; companyId: string },
    purpose: 'DISBURSEMENT_EXPIRED' | 'DISBURSEMENT_FAILED',
    keyPrefix: string,
  ): Promise<void> {
    try {
      const prepared = await this.templateSender.prepare({
        logicalKey: `${keyPrefix}:${approval.id}`,
        origin: 'DISBURSEMENT',
        context: {
          companyId: approval.companyId,
          disbursementApprovalId: approval.id,
        },
        selection: { mode: 'DEFAULT', purpose },
      });
      // A held notice stays visible to the admin, who resumes it after fixing the template.
      if (prepared.status === 'QUEUED')
        await this.whatsapp.enqueuePreparedTemplate(prepared.intentId);
      await this.prisma.disbursementApproval.update({
        where: { id: approval.id },
        data: { noticeSentAt: new Date() },
      });
    } catch {
      this.logger.warn(`Aviso de pagamento pendente: ${approval.id}`);
    }
  }

  private async send(approval: DisbursementApproval): Promise<void> {
    const prepared = await this.templateSender.prepare({
      logicalKey: `disbursement-approval:${approval.id}`,
      origin: 'DISBURSEMENT',
      context: {
        companyId: approval.companyId,
        disbursementApprovalId: approval.id,
      },
      selection: { mode: 'DEFAULT', purpose: 'DISBURSEMENT_APPROVAL' },
    });
    if (prepared.status === 'BLOCKED')
      return this.notSent(
        approval,
        'O template do pedido de aprovação está retido. Fale com o suporte CifraMais.',
      );
    await this.prisma.disbursementApproval.update({
      where: { id: approval.id },
      data: { intentId: prepared.intentId },
    });
    try {
      await this.whatsapp.dispatchIntent(prepared.intentId);
    } catch {
      const intent = await this.prisma.communicationOutboundIntent.findUnique({
        where: { id: prepared.intentId },
        select: { state: true },
      });
      // Waiting for the channel limit or an uncertain result may still reach the
      // approver: the request stays open until it is answered or expires.
      if (intent?.state === 'FAILED' || intent?.state === 'BLOCKED')
        return this.notSent(
          approval,
          'Não foi possível enviar o pedido de aprovação pelo WhatsApp. Tente novamente ou fale com o suporte CifraMais.',
        );
    }
  }

  private async notSent(
    approval: DisbursementApproval,
    message: string,
  ): Promise<never> {
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, approval.companyId, approval.batchId);
      await this.close(tx, approval, 'HELD', 'DRAFT');
    });
    throw new ConflictException({
      code: 'DISBURSEMENT_APPROVAL_NOT_SENT',
      message,
    });
  }

  /** Ends a request still awaiting; its batch moves only if this is still its current request. */
  private async close(
    tx: Tx,
    approval: DisbursementApproval,
    state: 'EXPIRED' | 'INVALIDATED' | 'HELD',
    batchStatus: 'EXPIRED' | 'DRAFT',
  ): Promise<void> {
    const closed = await tx.disbursementApproval.updateMany({
      where: { id: approval.id, state: 'AWAITING' },
      data: { state },
    });
    if (!closed.count) return;
    const moved = await tx.disbursementBatch.updateMany({
      where: {
        id: approval.batchId,
        companyId: approval.companyId,
        status: 'AWAITING_APPROVAL',
        approvalRequests: approval.requestNumber,
      },
      data: { status: batchStatus, version: { increment: 1 } },
    });
    if (moved.count && batchStatus === 'EXPIRED')
      await tx.disbursementItem.updateMany({
        where: {
          batchId: approval.batchId,
          companyId: approval.companyId,
          status: 'PENDING',
        },
        data: { status: 'CANCELED' },
      });
  }

  /** Current request, unchanged batch, feature on and the same approver. */
  private async stillAsRequested(
    tx: Tx,
    approval: DisbursementApproval,
  ): Promise<boolean> {
    const batch = await tx.disbursementBatch.findUniqueOrThrow({
      where: { id: approval.batchId },
      select: {
        status: true,
        approvalRequests: true,
        contentHash: true,
        reference: true,
        issuerIdentityId: true,
      },
    });
    const settings = await this.settings.current(approval.companyId, tx);
    if (
      batch.status !== 'AWAITING_APPROVAL' ||
      batch.approvalRequests !== approval.requestNumber ||
      batch.contentHash !== approval.contentHash ||
      !batch.issuerIdentityId ||
      !settings?.enabled ||
      messageRecipient({ type: 'PHONE', value: settings.approverPhone })
        .hash !== approval.approverPhoneHash
    )
      return false;
    const items = await tx.disbursementItem.findMany({
      where: { batchId: approval.batchId, companyId: approval.companyId },
    });
    return (
      batchContentHash({
        reference: batch.reference,
        issuerIdentityId: batch.issuerIdentityId,
        items,
      }) === approval.contentHash
    );
  }

  /**
   * Quick-reply taps citing this request's message, on the same channel, from the
   * approver it was sent to. Only WhatsApp's `button` messages count: typed text never does.
   */
  private async taps(approval: DisbursementApproval): Promise<Tap[]> {
    if (!approval.intentId || !approval.approveLabel || !approval.rejectLabel)
      return [];
    const intent = await this.prisma.communicationOutboundIntent.findUnique({
      where: { id: approval.intentId },
      select: {
        message: {
          select: { externalMessageId: true, transportChannelId: true },
        },
      },
    });
    const sent = intent?.message;
    if (!sent?.externalMessageId || !sent.transportChannelId) return [];
    const settings = await this.prisma.disbursementSettings.findUnique({
      where: {
        companyId_version: {
          companyId: approval.companyId,
          version: approval.settingsVersion,
        },
      },
      select: { approverPhone: true },
    });
    if (!settings) return [];
    const replies = await this.prisma.communicationMessage.findMany({
      where: {
        direction: 'INBOUND',
        messageType: 'button',
        transportChannelId: sent.transportChannelId,
        replyToExternalMessageId: sent.externalMessageId,
        anonymizedAt: null,
        conversation: {
          recipientHash: { in: approverPhoneHashes(settings.approverPhone) },
        },
      },
      orderBy: [
        { providerTimestamp: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      take: 20,
      select: {
        id: true,
        externalMessageId: true,
        conversationId: true,
        content: true,
        providerTimestamp: true,
        createdAt: true,
      },
    });
    return replies
      .filter(
        (reply) =>
          reply.content === approval.approveLabel ||
          reply.content === approval.rejectLabel,
      )
      .map((reply) => ({
        id: reply.id,
        externalMessageId: reply.externalMessageId,
        conversationId: reply.conversationId,
        approve: reply.content === approval.approveLabel,
        at: reply.providerTimestamp ?? reply.createdAt,
      }));
  }

  private async reply(
    approval: DisbursementApproval,
    tap: Tap,
    content: string,
  ): Promise<void> {
    const conversation = await this.prisma.communicationConversation.findUnique(
      {
        where: { id: tap.conversationId },
        select: { recipientType: true, recipientEncrypted: true },
      },
    );
    if (
      conversation?.recipientType !== 'PHONE' ||
      !conversation.recipientEncrypted
    )
      return;
    // A platform message about the platform's feature, not a company collection message.
    await this.whatsapp.enqueueAdminReply(
      this.crypto.decrypt(conversation.recipientEncrypted),
      content,
      `disbursement-ack:${approval.id}`,
      {
        context: { companyId: approval.companyId },
        ...(tap.externalMessageId
          ? { replyToExternalMessageId: tap.externalMessageId }
          : {}),
      },
    );
    await this.prisma.disbursementApproval.updateMany({
      where: { id: approval.id, ackSentAt: null },
      data: { ackSentAt: new Date() },
    });
  }

  /** Company first, then batch: the same order as the admin settings, never a deadlock. */
  private async lock(tx: Tx, companyId: string, batchId: string) {
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${companyId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "DisbursementBatch" WHERE id=${batchId} AND "companyId"=${companyId} FOR UPDATE`;
  }

  private unavailable(): never {
    conflict(
      'DISBURSEMENT_NOT_READY',
      'Pagamentos a colaboradores estão temporariamente indisponíveis. Fale com o suporte CifraMais.',
    );
  }
}
