import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WhatsappTemplatePendingSend } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateContextService } from '../templates/template-context.service';
import {
  ReadyTemplate,
  ResumeItem,
  ResumeResult,
  ResumeReview,
  TemplateSelection,
  TemplateSendRequest,
  TemplateSnapshot,
} from '../templates/template-contracts';
import {
  lockGrants,
  lockLogicalKey,
  lockTemplates,
} from '../templates/template-locks';
import { TemplatePolicyService } from '../templates/template-policy.service';
import {
  RenderedSend,
  renderSend,
  reserveTemplateIntent,
} from '../templates/template-reservation';
import { ruleStepSelection } from '../templates/template-selection';
import { OutboundIntentService } from './outbound-intent.service';

type Tx = Prisma.TransactionClient;
type Action = 'RESUME' | 'CLOSE' | 'KEEP_BLOCKED';

export const RESUME_REVIEW_TTL_MS = 15 * 60_000;
export const RESUME_REVIEW_MAX_ITEMS = 50;

/** What the review stores per item: versions and fingerprints, never text or phone. */
interface StoredItem {
  pendingId: string;
  pendingVersion: number;
  companyId: string;
  invoiceId: string | null;
  action: Action;
  reason: string | null;
  /** Explicit change of template decided in the review, if any. */
  replacementTemplateId: string | null;
  selection: TemplateSelection | null;
  snapshot: TemplateSnapshot | null;
  contextFingerprint: string | null;
  templateName: string | null;
}

interface Evaluation extends StoredItem {
  template?: ReadyTemplate;
  rendered?: RenderedSend;
  request?: TemplateSendRequest;
}

function staleReview(): ConflictException {
  return new ConflictException({
    code: 'VERSION_CHANGED',
    message: 'A pendência mudou. Revise novamente.',
  });
}

/**
 * Admin review of held template sends. Correcting a template never resumes anything by
 * itself: the admin previews, then confirms. Confirmation revalidates everything under
 * the shared lock order and, in one transaction, records the authorization, closes or
 * resumes each hold and reserves the successor intent; delivery then follows the
 * persistent intent recovery. Accepted, in-flight and uncertain sends are never resumed.
 */
@Injectable()
export class TemplateResumeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly crypto: PaymentCryptoService,
    private readonly intents: OutboundIntentService,
    private readonly policy: TemplatePolicyService,
    private readonly context: TemplateContextService,
  ) {}

  async preview(
    items: ResumeItem[],
    actorUserId: string,
  ): Promise<ResumeReview> {
    const ids = items.map((item) => item.pendingId);
    if (
      !items.length ||
      items.length > RESUME_REVIEW_MAX_ITEMS ||
      new Set(ids).size !== ids.length
    )
      throw new BadRequestException(
        `Selecione de 1 a ${RESUME_REVIEW_MAX_ITEMS} pendências distintas.`,
      );
    return this.prisma.$transaction(
      async (tx) => {
        const evaluations: Evaluation[] = [];
        for (const item of items) {
          const pending = await tx.whatsappTemplatePendingSend.findUnique({
            where: { id: item.pendingId },
          });
          if (!pending)
            throw new NotFoundException('Pendência não encontrada.');
          evaluations.push(
            await this.evaluate(tx, pending, item.replacementTemplateId),
          );
        }
        const expiresAt = new Date(Date.now() + RESUME_REVIEW_TTL_MS);
        const review = await tx.whatsappTemplateResumeReview.create({
          data: {
            actorUserId,
            expiresAt,
            items: evaluations.map((evaluation) =>
              this.stored(evaluation),
            ) as unknown as Prisma.InputJsonValue,
          },
          select: { id: true },
        });
        return {
          id: review.id,
          expiresAt: expiresAt.toISOString(),
          items: evaluations.map((evaluation) => ({
            pendingId: evaluation.pendingId,
            companyId: evaluation.companyId,
            invoiceId: evaluation.invoiceId,
            templateId: evaluation.snapshot?.templateId ?? null,
            templateName: evaluation.templateName,
            action: evaluation.action,
            reason: evaluation.reason,
            // Rendered for the authenticated admin response only; never persisted.
            previewBody: evaluation.rendered?.body ?? null,
          })),
        };
      },
      { timeout: 30_000 },
    );
  }

  async confirm(
    reviewId: string,
    idempotencyId: string,
    actorUserId: string,
  ): Promise<ResumeResult> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        idempotencyId,
      )
    )
      throw new BadRequestException('Chave de confirmação inválida.');
    try {
      return await this.prisma.$transaction(
        (tx) =>
          this.confirmInTransaction(tx, reviewId, idempotencyId, actorUserId),
        { timeout: 30_000 },
      );
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // A concurrent confirmation won: return its persisted result when it is ours.
        const winner =
          await this.prisma.whatsappTemplateResumeReview.findUnique({
            where: { id: reviewId },
            select: { confirmationKey: true, result: true },
          });
        if (winner?.confirmationKey === idempotencyId && winner.result)
          return winner.result as unknown as ResumeResult;
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'Chave de confirmação já utilizada em outra revisão.',
        });
      }
      throw error;
    }
  }

  private async confirmInTransaction(
    tx: Tx,
    reviewId: string,
    idempotencyId: string,
    actorUserId: string,
  ): Promise<ResumeResult> {
    const [locked] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "WhatsappTemplateResumeReview" WHERE "id" = ${reviewId} FOR UPDATE`;
    if (!locked) throw new NotFoundException('Revisão não encontrada.');
    const review = await tx.whatsappTemplateResumeReview.findUniqueOrThrow({
      where: { id: reviewId },
    });
    if (review.confirmedAt) {
      if (review.confirmationKey === idempotencyId && review.result)
        return review.result as unknown as ResumeResult;
      throw new ConflictException({
        code: 'REVIEW_ALREADY_CONFIRMED',
        message: 'Revisão já confirmada.',
      });
    }
    const reused = await tx.whatsappTemplateResumeReview.findUnique({
      where: { confirmationKey: idempotencyId },
      select: { id: true },
    });
    if (reused)
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'Chave de confirmação já utilizada em outra revisão.',
      });
    if (review.expiresAt <= new Date())
      throw new ConflictException({
        code: 'REVIEW_EXPIRED',
        message: 'A prévia expirou. Revise novamente.',
      });
    const stored = review.items as unknown as StoredItem[];
    const pendings = await tx.whatsappTemplatePendingSend.findMany({
      where: { id: { in: stored.map((item) => item.pendingId) } },
    });
    // Shared lock order: templates, grants, logical keys, then intents.
    const templateIds = stored.flatMap((item) =>
      item.snapshot ? [item.snapshot.templateId] : [],
    );
    await lockTemplates(tx, templateIds, 'SHARE');
    for (const companyId of [
      ...new Set(stored.map((item) => item.companyId)),
    ].sort())
      await lockGrants(
        tx,
        companyId,
        stored
          .filter((item) => item.companyId === companyId && item.snapshot)
          .map((item) => item.snapshot!.templateId),
        'SHARE',
      );
    for (const key of pendings.map((pending) => pending.logicalKey).sort())
      await lockLogicalKey(tx, key);

    const intentIds: string[] = [];
    const closedPendingIds: string[] = [];
    for (const item of stored) {
      const pending = await tx.whatsappTemplatePendingSend.findUniqueOrThrow({
        where: { id: item.pendingId },
      });
      if (pending.version !== item.pendingVersion) throw staleReview();
      const current = await this.evaluate(
        tx,
        pending,
        item.replacementTemplateId ?? undefined,
      );
      // Anything relevant that changed since the preview needs a new review.
      if (!isDeepStrictEqual(this.stored(current), item)) throw staleReview();
      if (current.action === 'RESUME') {
        intentIds.push(
          await this.resume(tx, pending, current, reviewId, actorUserId),
        );
      } else if (current.action === 'CLOSE') {
        await this.close(tx, pending, current.reason, reviewId, actorUserId);
        closedPendingIds.push(pending.id);
      }
    }
    const result: ResumeResult = { reviewId, intentIds, closedPendingIds };
    await tx.whatsappTemplateResumeReview.update({
      where: { id: reviewId },
      data: {
        confirmationKey: idempotencyId,
        confirmedAt: new Date(),
        confirmedByUserId: actorUserId,
        result: result as unknown as Prisma.InputJsonValue,
      },
    });
    return result;
  }

  private async evaluate(
    tx: Tx,
    pending: WhatsappTemplatePendingSend,
    replacementTemplateId?: string,
  ): Promise<Evaluation> {
    const base: Evaluation = {
      pendingId: pending.id,
      pendingVersion: pending.version,
      companyId: pending.companyId,
      invoiceId: pending.invoiceId,
      action: 'KEEP_BLOCKED',
      reason: null,
      replacementTemplateId: replacementTemplateId ?? null,
      selection: null,
      snapshot: null,
      contextFingerprint: null,
      templateName: null,
    };
    const keep = (reason: string): Evaluation => ({ ...base, reason });
    const close = (reason: string): Evaluation => ({
      ...base,
      action: 'CLOSE',
      reason,
    });
    if (pending.state !== 'BLOCKED') return keep(`PENDING_${pending.state}`);
    // Known acceptance closes; in-flight or uncertain results go to their own triage.
    const live = await tx.communicationOutboundIntent.findFirst({
      where: {
        OR: [
          { logicalKey: pending.logicalKey },
          ...(pending.currentIntentId ? [{ id: pending.currentIntentId }] : []),
        ],
        state: { in: ['PENDING', 'SENDING', 'ACCEPTED', 'UNCERTAIN'] },
      },
      select: { state: true },
    });
    if (live?.state === 'ACCEPTED') return close('ALREADY_SENT');
    if (live) return keep('TRANSMISSION_UNKNOWN');
    const stored = pending.request as unknown as TemplateSendRequest;
    if (stored.origin === 'COLLECTION' && pending.invoiceId) {
      const invoice = await tx.invoice.findFirst({
        where: { id: pending.invoiceId, companyId: pending.companyId },
        select: { status: true, debtor: { select: { whatsappOptIn: true } } },
      });
      if (!invoice || invoice.status !== 'PENDING')
        return close('INVOICE_NOT_PENDING');
      if (!invoice.debtor.whatsappOptIn) return keep('OPT_IN_MISSING');
    }
    if (stored.origin === 'ACTIVATION') {
      const activation = stored.context.activationId
        ? await tx.efiOnboarding.findFirst({
            where: {
              id: stored.context.activationId,
              companyId: pending.companyId,
            },
            select: { sensitiveDataDeletedAt: true },
          })
        : null;
      if (!activation || activation.sensitiveDataDeletedAt)
        return close('ACTIVATION_UNAVAILABLE');
    }
    const selection = await this.selectionFor(
      tx,
      stored,
      replacementTemplateId,
    );
    const decision = await this.policy.resolve(
      tx,
      pending.companyId,
      selection,
    );
    if (!decision.allowed) return { ...keep(decision.code), selection };
    const request: TemplateSendRequest = { ...stored, selection };
    const rendered = await renderSend(
      this.context,
      this.crypto,
      tx,
      request,
      decision.template,
    );
    if (!rendered.ok) return { ...keep(rendered.code), selection };
    return {
      ...base,
      action: 'RESUME',
      selection,
      snapshot: decision.template.snapshot,
      contextFingerprint: rendered.loaded.contextFingerprint,
      templateName: decision.template.name,
      template: decision.template,
      rendered,
      request,
    };
  }

  /** Explicit replacement, else the rule step's current choice, else the stored one. */
  private async selectionFor(
    tx: Tx,
    request: TemplateSendRequest,
    replacementTemplateId?: string,
  ): Promise<TemplateSelection> {
    if (replacementTemplateId)
      return { mode: 'EXPLICIT', templateId: replacementTemplateId };
    if (request.ruleStepId) {
      const step = await tx.collectionRuleStep.findFirst({
        where: {
          id: request.ruleStepId,
          channel: 'WHATSAPP',
          profile: { companyId: request.context.companyId },
        },
      });
      if (step) return ruleStepSelection(step);
    }
    return request.selection;
  }

  private stored(evaluation: Evaluation): StoredItem {
    return {
      pendingId: evaluation.pendingId,
      pendingVersion: evaluation.pendingVersion,
      companyId: evaluation.companyId,
      invoiceId: evaluation.invoiceId,
      action: evaluation.action,
      reason: evaluation.reason,
      replacementTemplateId: evaluation.replacementTemplateId,
      selection: evaluation.selection,
      snapshot: evaluation.snapshot,
      contextFingerprint: evaluation.contextFingerprint,
      templateName: evaluation.templateName,
    };
  }

  private async resume(
    tx: Tx,
    pending: WhatsappTemplatePendingSend,
    evaluation: Evaluation,
    reviewId: string,
    actorUserId: string,
  ): Promise<string> {
    const latest = await tx.communicationOutboundIntent.aggregate({
      where: { logicalKey: pending.logicalKey },
      _max: { generation: true },
    });
    const generation =
      latest._max.generation !== null
        ? latest._max.generation + 1
        : pending.currentIntentId
          ? 1
          : 0;
    // A successor: the original attempt keeps its payload and state as history.
    const intentId = await reserveTemplateIntent(
      {
        intents: this.intents,
        crypto: this.crypto,
        transportChannelId: this.config.getOrThrow<string>(
          'META_PHONE_NUMBER_ID',
        ),
      },
      tx,
      {
        request: evaluation.request!,
        template: evaluation.template!,
        rendered: evaluation.rendered!,
        idempotencyKey: `resume:${reviewId}:${pending.id}`,
        generation,
        resumeReviewId: reviewId,
      },
    );
    const updated = await tx.whatsappTemplatePendingSend.update({
      where: { id: pending.id },
      data: {
        state: 'RESUMED',
        currentIntentId: intentId,
        version: { increment: 1 },
        resolvedAt: new Date(),
      },
      select: { version: true },
    });
    const request = evaluation.request!;
    if (request.ruleStepId && request.context.invoiceId)
      await tx.collectionAttempt.updateMany({
        where: {
          companyId: pending.companyId,
          invoiceId: request.context.invoiceId,
          ruleStepId: request.ruleStepId,
          channel: 'WHATSAPP',
          status: 'BLOCKED',
        },
        data: { status: 'QUEUED' },
      });
    await tx.whatsappTemplateAudit.create({
      data: {
        companyId: pending.companyId,
        templateId: evaluation.snapshot?.templateId ?? null,
        actorUserId,
        action: 'PENDING_RESUMED',
        details: {
          pendingId: pending.id,
          reviewId,
          intentId,
          generation,
          version: updated.version,
        },
      },
    });
    return intentId;
  }

  private async close(
    tx: Tx,
    pending: WhatsappTemplatePendingSend,
    reason: string | null,
    reviewId: string,
    actorUserId: string,
  ): Promise<void> {
    const updated = await tx.whatsappTemplatePendingSend.update({
      where: { id: pending.id },
      data: {
        state: 'CLOSED',
        closedReason: reason,
        version: { increment: 1 },
        resolvedAt: new Date(),
      },
      select: { version: true },
    });
    await tx.whatsappTemplateAudit.create({
      data: {
        companyId: pending.companyId,
        templateId: pending.templateId,
        actorUserId,
        action: 'PENDING_CLOSED',
        details: {
          pendingId: pending.id,
          reviewId,
          reason,
          version: updated.version,
        },
      },
    });
  }
}
