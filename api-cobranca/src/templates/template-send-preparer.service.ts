import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { OutboundIntentService } from '../communications/outbound-intent.service';
import { messageRecipient } from '../communications/message-context';
import { TemplatePendingService } from '../communications/template-pending.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import type { DispatchInput } from '../whatsapp/outbound-dispatcher.service';
import { TemplateContextService } from './template-context.service';
import {
  ReadyTemplate,
  TemplateBlockCode,
  TemplateSendRequest,
} from './template-contracts';
import { lockLogicalKey } from './template-locks';
import { TemplatePolicyService } from './template-policy.service';
import { renderTemplate } from './template-renderer';

type Tx = Prisma.TransactionClient;

export type PrepareResult =
  | { status: 'QUEUED'; intentId: string }
  | { status: 'BLOCKED'; pendingId: string; code: TemplateBlockCode | null };

export interface PrepareOptions {
  /**
   * After a definitive rejection that never reached the provider, prepare the next
   * generation of the same communication (daily activation notices). Never after an
   * accepted, uncertain or in-flight attempt.
   */
  renewAfterRejection?: boolean;
}

const RETENTION_YEARS = 5;

/**
 * Single entry point for template sends: policy, trusted context, rendering and the
 * reservation in one transaction serialized by the logical key. It never transmits and
 * never picks another template; a refusal becomes a persistent hold (admin replies get
 * an immediate error instead, since the admin is present to act on it).
 */
@Injectable()
export class TemplateSendPreparerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly crypto: PaymentCryptoService,
    private readonly intents: OutboundIntentService,
    private readonly pending: TemplatePendingService,
    private readonly policy: TemplatePolicyService,
    private readonly context: TemplateContextService,
  ) {}

  async prepare(
    request: TemplateSendRequest,
    options: PrepareOptions = {},
  ): Promise<PrepareResult> {
    if (
      !request.logicalKey ||
      request.logicalKey.length > 180 ||
      !request.context.companyId
    )
      throw new BadRequestException('Envio de template inválido.');
    return this.prisma.$transaction(
      async (tx) => {
        await lockLogicalKey(tx, request.logicalKey);
        const hold = await this.pending.findByLogicalKey(
          tx,
          request.logicalKey,
        );
        if (hold)
          return hold.state === 'RESUMED' && hold.currentIntentId
            ? { status: 'QUEUED' as const, intentId: hold.currentIntentId }
            : { status: 'BLOCKED' as const, pendingId: hold.id, code: null };
        // Repeated producers return what already exists for this communication.
        const previous = await tx.communicationOutboundIntent.findFirst({
          where: {
            OR: [
              { logicalKey: request.logicalKey },
              { idempotencyKey: request.logicalKey },
            ],
          },
          orderBy: [{ generation: 'desc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            state: true,
            transmission: true,
            generation: true,
          },
        });
        let generation = 0;
        if (previous) {
          const renew =
            options.renewAfterRejection &&
            previous.state === 'FAILED' &&
            previous.transmission === 'NOT_SENT';
          if (!renew)
            return { status: 'QUEUED' as const, intentId: previous.id };
          generation = previous.generation + 1;
        }
        const decision = await this.policy.resolve(
          tx,
          request.context.companyId,
          request.selection,
        );
        if (!decision.allowed) return this.refuse(tx, request, decision.code);
        return this.reserve(tx, request, decision.template, generation);
      },
      { timeout: 15_000 },
    );
  }

  private async reserve(
    tx: Tx,
    request: TemplateSendRequest,
    template: ReadyTemplate,
    generation: number,
  ): Promise<PrepareResult> {
    const adminReply = request.origin === 'ADMIN_REPLY';
    let loaded: Awaited<ReturnType<TemplateContextService['load']>>;
    try {
      loaded = await this.context.load(
        request.context,
        request.origin,
        template.mapping,
        tx,
      );
    } catch (error: unknown) {
      if (adminReply) throw error;
      return this.refuse(tx, request, 'VALUE_MISSING', template);
    }
    const recipient = adminReply
      ? await this.conversationRecipient(tx, request.conversationId)
      : loaded.recipient;
    if (!recipient) return this.refuse(tx, request, 'VALUE_MISSING', template);
    const rendered = renderTemplate(
      template.parsed,
      template.mapping,
      loaded.values,
      loaded.paymentUrl,
    );
    if (!rendered.ok)
      return this.refuse(tx, request, rendered.code, template, rendered.field);
    const phone = messageRecipient({ type: 'PHONE', value: recipient });
    const retentionExpiresAt = new Date();
    retentionExpiresAt.setUTCFullYear(
      retentionExpiresAt.getUTCFullYear() + RETENTION_YEARS,
    );
    const conversation = await tx.communicationConversation.upsert({
      where: {
        channel_recipientHash: {
          channel: 'WHATSAPP',
          recipientHash: phone.hash,
        },
      },
      create: {
        channel: 'WHATSAPP',
        recipientHash: phone.hash,
        recipientType: 'PHONE',
        recipientEncrypted: this.crypto.encrypt(phone.value),
        retentionExpiresAt,
      },
      update: {},
      select: { id: true },
    });
    const { companyId, invoiceId, debtorId } = request.context;
    const payload: DispatchInput = {
      companyId,
      ...(invoiceId ? { invoiceId } : {}),
      ...(debtorId ? { debtorId } : {}),
      ...(request.ruleStepId ? { ruleStepId: request.ruleStepId } : {}),
      phoneNumber: phone.value,
      content: rendered.body,
      messageType: 'template',
      templateName: template.name,
      languageCode: template.language,
      bodyParameters: rendered.bodyParameters,
      ...(template.parsed.paymentButton
        ? { paymentButtonFromInvoice: true }
        : {}),
      ...(adminReply ? { origin: 'ADMIN_REPLY' as const } : {}),
      ...(request.replyToExternalMessageId
        ? { replyToExternalMessageId: request.replyToExternalMessageId }
        : {}),
    };
    const { reservation } = await this.intents.reserveInTransaction(tx, {
      idempotencyKey: generation
        ? `${request.logicalKey}#${generation}`
        : request.logicalKey,
      conversationId: conversation.id,
      transport: 'DATAFY',
      transportChannelId: this.config.getOrThrow<string>(
        'META_PHONE_NUMBER_ID',
      ),
      recipient: phone,
      context: {
        companyId,
        ...(invoiceId ? { invoiceId } : {}),
        ...(debtorId ? { debtorId } : {}),
      },
      content: rendered.body,
      messageType: 'template',
      payload,
      retentionExpiresAt,
      replyToExternalMessageId: request.replyToExternalMessageId ?? null,
      template: {
        logicalKey: request.logicalKey,
        generation,
        snapshot: template.snapshot,
        contextFingerprint: loaded.contextFingerprint,
        context: { logicalKey: request.logicalKey, request },
      },
    });
    return { status: 'QUEUED', intentId: reservation.id };
  }

  private async refuse(
    tx: Tx,
    request: TemplateSendRequest,
    code: TemplateBlockCode,
    template?: ReadyTemplate,
    field?: string,
  ): Promise<PrepareResult> {
    if (request.origin === 'ADMIN_REPLY')
      throw new HttpException(
        {
          code,
          ...(field ? { field } : {}),
          message:
            code === 'VALUE_MISSING'
              ? 'Faltam dados do contexto para preencher o template.'
              : 'Template indisponível para a empresa selecionada.',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    const hold = await this.pending.block(tx, {
      request,
      code,
      ...(template ? { snapshot: template.snapshot } : {}),
    });
    return { status: 'BLOCKED', pendingId: hold.id, code };
  }

  private async conversationRecipient(
    tx: Tx,
    conversationId: string | undefined,
  ): Promise<string | null> {
    if (!conversationId) return null;
    const conversation = await tx.communicationConversation.findUnique({
      where: { id: conversationId },
      select: { channel: true, recipientType: true, recipientEncrypted: true },
    });
    if (
      conversation?.channel !== 'WHATSAPP' ||
      conversation.recipientType === 'BSUID' ||
      !conversation.recipientEncrypted
    )
      return null;
    return this.crypto.decrypt(conversation.recipientEncrypted);
  }
}
