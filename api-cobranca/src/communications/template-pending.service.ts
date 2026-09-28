import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  PendingInput,
  PendingRef,
  TemplateBlockCode,
  TemplatePolicyError,
  TemplateSendRequest,
  TemplateSnapshot,
} from '../templates/template-contracts';
import { lockLogicalKey } from '../templates/template-locks';
import { TemplatePolicyService } from '../templates/template-policy.service';

type Tx = Prisma.TransactionClient;

const pendingSelect = {
  id: true,
  version: true,
  state: true,
  currentIntentId: true,
} satisfies Prisma.WhatsappTemplatePendingSendSelect;

/** What an intent persists to be revalidated later; identifiers only. */
export interface StoredTemplateContext {
  logicalKey: string;
  request: TemplateSendRequest;
}

export function templateSelectionId(
  request: TemplateSendRequest,
  snapshot?: TemplateSnapshot,
): string | null {
  return (
    snapshot?.templateId ??
    (request.selection.mode === 'EXPLICIT'
      ? request.selection.templateId
      : null)
  );
}

/**
 * Persistent holds of template sends. A hold exists even before any intent, keeps one
 * row per logical communication and only turns intents that provably never reached the
 * provider into BLOCKED. Accepted, uncertain and in-flight intents are never touched.
 */
@Injectable()
export class TemplatePendingService {
  private readonly logger = new Logger(TemplatePendingService.name);
  private reconcileCursor = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: TemplatePolicyService,
  ) {}

  async block(tx: Tx, input: PendingInput): Promise<PendingRef> {
    const { request, code } = input;
    await lockLogicalKey(tx, request.logicalKey);
    let intentId: string | null = null;
    if (input.intentId) {
      // Only a pending intent (claimed by nobody) or a known non-transmitted failure is held.
      const held = await tx.communicationOutboundIntent.updateMany({
        where: {
          id: input.intentId,
          OR: [
            { state: 'PENDING' },
            { state: 'FAILED', transmission: 'NOT_SENT' },
            { state: 'BLOCKED' },
          ],
        },
        data: {
          state: 'BLOCKED',
          lastErrorCode: `TEMPLATE_${code}`.slice(0, 64),
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      if (held.count) {
        intentId = input.intentId;
        const intent = await tx.communicationOutboundIntent.findUniqueOrThrow({
          where: { id: input.intentId },
          select: { messageId: true },
        });
        await tx.communicationMessage.updateMany({
          where: { id: intent.messageId, externalMessageId: null },
          data: { status: 'blocked' },
        });
      }
    }
    await this.holdAttempt(tx, request);
    const existing = await tx.whatsappTemplatePendingSend.findUnique({
      where: { logicalKey: request.logicalKey },
    });
    const templateId = templateSelectionId(request, input.snapshot);
    const snapshot = (input.snapshot ?? Prisma.DbNull) as
      | Prisma.InputJsonValue
      | typeof Prisma.DbNull;
    const now = new Date();
    if (!existing) {
      const created = await tx.whatsappTemplatePendingSend.create({
        data: {
          logicalKey: request.logicalKey,
          companyId: request.context.companyId,
          origin: request.origin,
          invoiceId: request.context.invoiceId ?? null,
          debtorId: request.context.debtorId ?? null,
          ruleStepId: request.ruleStepId ?? null,
          templateId,
          request: this.storedRequest(request),
          code,
          snapshot,
          currentIntentId: intentId,
        },
        select: pendingSelect,
      });
      await this.audit(tx, request, templateId, 'PENDING_BLOCKED', {
        pendingId: created.id,
        code,
        version: created.version,
      });
      return created;
    }
    if (existing.state === 'CLOSED')
      return {
        id: existing.id,
        version: existing.version,
        state: existing.state,
        currentIntentId: existing.currentIntentId,
      };
    const changed =
      existing.state !== 'BLOCKED' ||
      existing.code !== code ||
      (intentId !== null && existing.currentIntentId !== intentId);
    const updated = await tx.whatsappTemplatePendingSend.update({
      where: { id: existing.id },
      data: {
        lastEvaluatedAt: now,
        occurrences: { increment: 1 },
        ...(changed
          ? {
              state: 'BLOCKED',
              code,
              snapshot,
              templateId: templateId ?? existing.templateId,
              version: { increment: 1 },
              blockedAt:
                existing.state === 'BLOCKED' ? existing.blockedAt : now,
              resolvedAt: null,
              ...(intentId ? { currentIntentId: intentId } : {}),
            }
          : {}),
      },
      select: pendingSelect,
    });
    if (changed)
      await this.audit(tx, request, templateId, 'PENDING_BLOCKED', {
        pendingId: existing.id,
        code,
        version: updated.version,
        reopened: existing.state === 'RESUMED',
      });
    return updated;
  }

  findByLogicalKey(tx: Tx, logicalKey: string): Promise<PendingRef | null> {
    return tx.whatsappTemplatePendingSend.findUnique({
      where: { logicalKey },
      select: pendingSelect,
    });
  }

  /**
   * Holds pending template intents whose snapshot is no longer valid (revoked grant, lost
   * approval, new review), so holds show up before the scheduled time. Scans by ID in
   * pages that resume where the previous call stopped; valid rows never stall progress.
   * The final dispatch check remains the guarantee.
   */
  async reconcileInvalidSnapshots(limit = 100): Promise<number> {
    const take = Math.max(1, Math.min(limit, 100));
    const rows = await this.prisma.communicationOutboundIntent.findMany({
      where: {
        state: 'PENDING',
        templateSnapshot: { not: Prisma.DbNull },
        id: { gt: this.reconcileCursor },
      },
      orderBy: { id: 'asc' },
      take,
      select: {
        id: true,
        companyId: true,
        templateSnapshot: true,
        templateContext: true,
      },
    });
    this.reconcileCursor = rows.length < take ? '' : (rows.at(-1)?.id ?? '');
    let blocked = 0;
    for (const row of rows) {
      const stored = row.templateContext as unknown as StoredTemplateContext;
      const snapshot = row.templateSnapshot as unknown as TemplateSnapshot;
      if (!row.companyId || !stored?.request) continue;
      try {
        await this.prisma.$transaction(async (tx) => {
          const code = await this.invalidCode(tx, row.companyId!, snapshot);
          if (!code) return;
          await this.block(tx, {
            request: stored.request,
            code,
            intentId: row.id,
            snapshot,
          });
          blocked++;
        });
      } catch {
        this.logger.warn(`TEMPLATE_HOLD_RECONCILE_DEFERRED ${row.id}`);
      }
    }
    return blocked;
  }

  private async invalidCode(
    tx: Tx,
    companyId: string,
    snapshot: TemplateSnapshot,
  ): Promise<TemplateBlockCode | null> {
    try {
      await this.policy.assertPinned(tx, companyId, snapshot);
      return null;
    } catch (error: unknown) {
      if (error instanceof TemplatePolicyError) return error.code;
      throw error;
    }
  }

  /** The rule step counts as attempted, so later steps keep their own calendar. */
  private async holdAttempt(
    tx: Tx,
    request: TemplateSendRequest,
  ): Promise<void> {
    const { companyId, invoiceId } = request.context;
    if (request.origin !== 'COLLECTION' || !request.ruleStepId || !invoiceId)
      return;
    const key = {
      companyId,
      invoiceId,
      ruleStepId: request.ruleStepId,
      channel: 'WHATSAPP' as const,
    };
    await tx.collectionAttempt.createMany({
      data: { ...key, status: 'BLOCKED' },
      skipDuplicates: true,
    });
    await tx.collectionAttempt.updateMany({
      where: { ...key, status: { in: ['QUEUED', 'FAILED'] } },
      data: { status: 'BLOCKED' },
    });
  }

  private storedRequest(request: TemplateSendRequest): Prisma.InputJsonValue {
    return {
      logicalKey: request.logicalKey,
      origin: request.origin,
      context: { ...request.context },
      selection: { ...request.selection },
      ...(request.ruleStepId ? { ruleStepId: request.ruleStepId } : {}),
      ...(request.conversationId
        ? { conversationId: request.conversationId }
        : {}),
      ...(request.replyToExternalMessageId
        ? { replyToExternalMessageId: request.replyToExternalMessageId }
        : {}),
    };
  }

  private async audit(
    tx: Tx,
    request: TemplateSendRequest,
    templateId: string | null,
    action: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await tx.whatsappTemplateAudit.create({
      data: {
        companyId: request.context.companyId,
        templateId,
        action,
        details: details as Prisma.InputJsonValue,
      },
    });
  }
}
