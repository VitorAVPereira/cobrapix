import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { CommunicationOutboundIntent, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import {
  OutboundIntentService,
  OutboundReservation,
} from '../communications/outbound-intent.service';
import { messageRecipient } from '../communications/message-context';
import { assertChannelAvailable } from '../communications/channel-availability';
import { assertRecipientNotSuppressed } from '../communications/recipient-suppression';
import { MessageQueueService } from '../queue/message.queue';
import { RateLimitService } from '../queue/services/rate-limit.service';
import { MessagingLimitService } from '../queue/services/messaging-limit.service';
import { WHATSAPP_TRANSPORT } from './transport/whatsapp-transport';
import type {
  WhatsappTransport,
  AcceptedMessage,
} from './transport/whatsapp-transport';
import { WhatsappTransportError } from './transport/whatsapp-transport.error';
import { isRecord } from './transport/whatsapp-transport.error';
import { PublicPaymentLinkService } from '../payment/payment-link.service';
import {
  CommunicationTokenService,
  interactiveTokenHash,
} from '../communications/communication-token.service';
import { reevaluateReplies } from '../communications/reply-attribution';
import {
  StoredTemplateContext,
  TemplatePendingService,
} from '../communications/template-pending.service';
import { TemplatePolicyService } from '../templates/template-policy.service';
import { TemplateContextService } from '../templates/template-context.service';
import {
  TemplateBlockCode,
  TemplatePolicyError,
  TemplateSendRequest,
  TemplateSnapshot,
} from '../templates/template-contracts';
import { lockLogicalKey } from '../templates/template-locks';
import { legacyTemplateRequest } from '../templates/template-selection';
import { requestTemplateSync } from '../templates/template-provider-state';

/**
 * Cloud API refusals that mean the approved template (or its parameters) no longer
 * matches what the provider holds. Classified by code, never by message text.
 */
const PROVIDER_TEMPLATE_CODES: Record<number, TemplateBlockCode> = {
  132000: 'REVIEW_REQUIRED',
  132001: 'NOT_APPROVED',
  132005: 'REVIEW_REQUIRED',
  132007: 'REVIEW_REQUIRED',
  132012: 'REVIEW_REQUIRED',
  132015: 'NOT_APPROVED',
  132016: 'NOT_APPROVED',
};

export function providerTemplateBlock(
  error: unknown,
): TemplateBlockCode | null {
  return error instanceof WhatsappTransportError &&
    error.outcome !== 'UNCERTAIN' &&
    error.providerCode !== undefined
    ? (PROVIDER_TEMPLATE_CODES[error.providerCode] ?? null)
    : null;
}

export interface DispatchPolicy {
  /** Invoice must still be pending and the debtor opted in, rechecked before transmission. */
  checksCollectionEligibility: boolean;
  /** Consumes the company's commercial daily quota and MessagingUsage. */
  consumesCompanyQuota: boolean;
  /** Acceptance and rejection are recorded on the collection (log/attempt). */
  recordsCollection: boolean;
}

/** What a send is for decides which collection rules apply; derived in this one place. */
export function dispatchPolicy(input: DispatchInput): DispatchPolicy {
  const platformReply = input.origin === 'ADMIN_REPLY';
  const collection =
    !platformReply && Boolean(input.companyId && input.invoiceId);
  return {
    checksCollectionEligibility: collection,
    consumesCompanyQuota: !platformReply,
    recordsCollection: collection,
  };
}

/** Quick replies may only target buttons the approved template declares as QUICK_REPLY. */
export function quickRepliesDeclared(
  components: unknown,
  indexes: number[] | undefined,
): boolean {
  if (!indexes?.length) return true;
  const buttons = Array.isArray(components)
    ? components.filter(isRecord).find((item) => item.type === 'BUTTONS')
        ?.buttons
    : undefined;
  return (
    Array.isArray(buttons) &&
    new Set(indexes).size === indexes.length &&
    indexes.every((index) => {
      const button: unknown = Number.isInteger(index)
        ? buttons[index]
        : undefined;
      return isRecord(button) && button.type === 'QUICK_REPLY';
    })
  );
}

export interface DispatchInput {
  companyId: string | null;
  invoiceId?: string;
  debtorId?: string;
  ruleStepId?: string;
  phoneNumber: string;
  content: string;
  messageType: 'text' | 'template';
  templateName?: string;
  languageCode?: string;
  bodyParameters?: string[];
  /** Named templates: `parameter_name` of each body parameter, in the same order. */
  bodyParameterNames?: string[];
  buttonUrlSuffix?: string | null;
  /** Platform reply: no collection eligibility, collection log or company commercial quota. */
  origin?: 'ADMIN_REPLY';
  /** Provider ID of the quoted message in the same conversation and channel. */
  replyToExternalMessageId?: string;
  /** Payment button link built at transmission; its signed token expires and cannot be hashed. */
  paymentButtonFromInvoice?: boolean;
  /** Template quick-reply button indexes that receive server-issued opaque references. */
  quickReplyButtons?: number[];
}

@Injectable()
export class OutboundDispatcherService {
  private readonly logger = new Logger(OutboundDispatcherService.name);
  private recovering = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly crypto: PaymentCryptoService,
    private readonly intents: OutboundIntentService,
    @Inject(WHATSAPP_TRANSPORT) private readonly transport: WhatsappTransport,
    private readonly queue: MessageQueueService,
    private readonly rates: RateLimitService,
    private readonly messaging: MessagingLimitService,
    private readonly tokens: CommunicationTokenService,
    private readonly paymentLinks: PublicPaymentLinkService,
    private readonly policy: TemplatePolicyService,
    private readonly pending: TemplatePendingService,
    private readonly templateContext: TemplateContextService,
  ) {}

  async prepare(
    input: DispatchInput,
    idempotencyKey: string,
  ): Promise<OutboundReservation> {
    const recipient = messageRecipient({
      type: 'PHONE',
      value: input.phoneNumber,
    });
    const retentionExpiresAt = new Date();
    retentionExpiresAt.setUTCFullYear(retentionExpiresAt.getUTCFullYear() + 5);
    const conversation = await this.prisma.communicationConversation.upsert({
      where: {
        channel_recipientHash: {
          channel: 'WHATSAPP',
          recipientHash: recipient.hash,
        },
      },
      create: {
        channel: 'WHATSAPP',
        recipientHash: recipient.hash,
        recipientType: 'PHONE',
        recipientEncrypted: this.crypto.encrypt(recipient.value),
        retentionExpiresAt,
      },
      update: {},
      select: { id: true },
    });
    const payload: DispatchInput = JSON.parse(
      JSON.stringify({ ...input, phoneNumber: recipient.value }),
    ) as DispatchInput;
    return this.intents.reserve({
      idempotencyKey,
      conversationId: conversation.id,
      transport: this.transport.kind,
      transportChannelId: this.config.getOrThrow<string>(
        'META_PHONE_NUMBER_ID',
      ),
      recipient,
      context: {
        companyId: input.companyId,
        invoiceId: input.invoiceId,
        debtorId: input.debtorId,
      },
      content: input.content,
      messageType: input.messageType,
      payload,
      retentionExpiresAt,
      replyToExternalMessageId: input.replyToExternalMessageId ?? null,
    });
  }

  /**
   * Key of the next attempt in a series. Only a definitively rejected attempt (FAILED:
   * never transmitted) frees a new key; pending, sending, accepted or uncertain attempts
   * keep theirs, so a retry can never produce a second transmission.
   */
  async attemptKey(series: string): Promise<string> {
    const rejected = await this.prisma.communicationOutboundIntent.count({
      where: { idempotencyKey: { startsWith: `${series}#` }, state: 'FAILED' },
    });
    return `${series}#${rejected}`;
  }

  async send(
    input: DispatchInput,
    idempotencyKey: string,
  ): Promise<AcceptedMessage> {
    const reservation = await this.prepare(input, idempotencyKey);
    return this.dispatch(reservation.id);
  }

  async enqueue(
    input: DispatchInput,
    idempotencyKey: string,
  ): Promise<{ id: string; status: string; externalMessageId: string | null }> {
    const intent = await this.prepare(input, idempotencyKey);
    return this.enqueueReserved(intent);
  }

  /** Queues an intent reserved by the template preparer; recovery covers a lost enqueue. */
  async enqueuePrepared(
    intentId: string,
  ): Promise<{ id: string; status: string; externalMessageId: string | null }> {
    const intent =
      await this.prisma.communicationOutboundIntent.findUniqueOrThrow({
        where: { id: intentId },
        select: { id: true, messageId: true, state: true },
      });
    return this.enqueueReserved(intent);
  }

  private async enqueueReserved(intent: {
    id: string;
    messageId: string;
    state: string;
  }): Promise<{
    id: string;
    status: string;
    externalMessageId: string | null;
  }> {
    if (intent.state === 'PENDING') {
      try {
        await Promise.race([
          this.queue.addOutboundIntentJob(intent.id),
          new Promise<void>((resolve) => setTimeout(resolve, 250)),
        ]);
      } catch {
        this.logger.warn('OUTBOUND_ENQUEUE_DEFERRED');
      }
    }
    const stored = await this.prisma.communicationMessage.findUniqueOrThrow({
      where: { id: intent.messageId },
      select: { id: true, status: true, externalMessageId: true },
    });
    return { ...stored, status: stored.status ?? 'pending' };
  }

  async dispatch(id: string): Promise<AcceptedMessage> {
    try {
      return await this.intents.execute(
        id,
        (intent) => this.validate(intent, this.payload(intent)),
        (intent) => this.transmit(intent, this.payload(intent)),
        (tx, intent, result) => this.recordAcceptance(tx, intent, result),
        (tx, intent) => this.authorize(tx, intent),
      );
    } catch (error: unknown) {
      // A template refusal becomes a durable hold, never a generic failure or a retry.
      const code =
        error instanceof TemplatePolicyError
          ? error.code
          : providerTemplateBlock(error);
      if (!code) throw error;
      await this.hold(id, code, !(error instanceof TemplatePolicyError));
      throw error instanceof TemplatePolicyError
        ? error
        : new TemplatePolicyError(code);
    }
  }

  /**
   * Final template authorization inside the claim transaction: pinned snapshot still valid
   * (same template, revisions, policy and grant versions), no hold for this communication
   * and the same recipient, links and values used at preparation.
   */
  private async authorize(
    tx: Prisma.TransactionClient,
    intent: CommunicationOutboundIntent,
  ): Promise<void> {
    const input = this.payload(intent);
    if (input.messageType !== 'template') return;
    const stored = intent.templateContext as unknown as StoredTemplateContext;
    if (
      !intent.templateSnapshot ||
      !intent.logicalKey ||
      !intent.companyId ||
      !stored?.request
    )
      throw new TemplatePolicyError('LEGACY_PAYLOAD');
    if (input.quickReplyButtons?.length)
      throw new TemplatePolicyError('UNSUPPORTED');
    const ready = await this.policy.assertPinned(
      tx,
      intent.companyId,
      intent.templateSnapshot as unknown as TemplateSnapshot,
    );
    await lockLogicalKey(tx, intent.logicalKey);
    const hold = await this.pending.findByLogicalKey(tx, intent.logicalKey);
    if (
      hold?.state === 'BLOCKED' ||
      (hold?.state === 'RESUMED' && hold.currentIntentId !== intent.id) ||
      hold?.state === 'CLOSED'
    )
      throw new TemplatePolicyError('VERSION_CHANGED');
    let fingerprint: string;
    try {
      fingerprint = (
        await this.templateContext.load(
          stored.request.context,
          stored.request.origin,
          ready.mapping,
          tx,
        )
      ).contextFingerprint;
    } catch {
      throw new TemplatePolicyError('CONTEXT_CHANGED');
    }
    if (fingerprint !== intent.templateContextFingerprint)
      throw new TemplatePolicyError('CONTEXT_CHANGED');
  }

  /** Persists the hold for a refused template intent; legacy intents without a tenant fail. */
  private async hold(
    id: string,
    code: TemplateBlockCode,
    providerRefused: boolean,
  ): Promise<void> {
    const intent = await this.prisma.communicationOutboundIntent.findUnique({
      where: { id },
    });
    if (!intent) return;
    const stored = intent.templateContext as unknown as StoredTemplateContext;
    const request =
      stored?.request ??
      (intent.companyId ? this.legacyRequest(intent) : undefined);
    await this.prisma.$transaction(async (tx) => {
      if (!request) {
        await tx.communicationOutboundIntent.updateMany({
          where: { id, state: 'PENDING' },
          data: { state: 'FAILED', lastErrorCode: 'LEGACY_PAYLOAD' },
        });
        return;
      }
      const waba = this.config.get<string>('META_BUSINESS_ACCOUNT_ID');
      if (providerRefused && waba) await requestTemplateSync(tx, waba);
      await this.pending.block(tx, {
        request,
        code,
        intentId: id,
        ...(intent.templateSnapshot
          ? {
              snapshot: intent.templateSnapshot as unknown as TemplateSnapshot,
            }
          : {}),
      });
    });
  }

  /** Intents prepared before the catalog change carry no selection: they need a review. */
  private legacyRequest(
    intent: CommunicationOutboundIntent,
  ): TemplateSendRequest {
    return legacyTemplateRequest(
      { ...intent, companyId: intent.companyId! },
      this.payload(intent),
    );
  }

  async rejectedCollection(id: string): Promise<{
    companyId: string;
    invoiceId: string;
    ruleStepId?: string;
  } | null> {
    const intent = await this.prisma.communicationOutboundIntent.findUnique({
      where: { id },
    });
    if (intent?.state !== 'FAILED' || !intent.payloadEncrypted) return null;
    const input = this.payload(intent);
    return dispatchPolicy(input).recordsCollection &&
      input.companyId &&
      input.invoiceId
      ? {
          companyId: input.companyId,
          invoiceId: input.invoiceId,
          ruleStepId: input.ruleStepId,
        }
      : null;
  }

  private payload(intent: CommunicationOutboundIntent): DispatchInput {
    if (!intent.payloadEncrypted) throw new Error('PAYLOAD_UNAVAILABLE');
    return JSON.parse(
      this.crypto.decrypt(intent.payloadEncrypted),
    ) as DispatchInput;
  }

  private async validate(
    intent: CommunicationOutboundIntent,
    input: DispatchInput,
  ): Promise<void> {
    if (
      intent.transport !== this.transport.kind ||
      intent.transportChannelId !==
        this.config.get<string>('META_PHONE_NUMBER_ID')
    )
      throw new Error('TRANSPORT_CHANGED_REVIEW_REQUIRED');
    // A paused channel holds queued intents until it is resumed; pausing never discards them.
    try {
      await assertChannelAvailable(this.prisma, 'META');
    } catch {
      throw new WhatsappTransportError(
        'Canal pausado. Envio permanece pendente.',
        'TEMPORARY',
        'NOT_SENT',
        undefined,
        undefined,
        60,
      );
    }
    try {
      await assertRecipientNotSuppressed(this.prisma, input.phoneNumber);
    } catch (error: unknown) {
      if (!(error instanceof ConflictException)) throw error;
      throw new WhatsappTransportError(
        'Destinatario pausado: cancelamento aguarda revisao administrativa.',
        'REJECTED',
        'NOT_SENT',
        undefined,
        undefined,
        undefined,
        'RECIPIENT_SUPPRESSED',
      );
    }
    if (input.messageType === 'text') {
      const message = await this.prisma.communicationMessage.findUniqueOrThrow({
        where: { id: intent.messageId },
        select: { conversation: { select: { serviceWindowExpiresAt: true } } },
      });
      if (
        !message.conversation.serviceWindowExpiresAt ||
        message.conversation.serviceWindowExpiresAt <= new Date()
      )
        throw new WhatsappTransportError(
          'A janela de atendimento do WhatsApp esta fechada.',
          'REJECTED',
          'NOT_SENT',
          undefined,
          undefined,
          undefined,
          'SERVICE_WINDOW_CLOSED',
        );
    }
    const policy = dispatchPolicy(input);
    if (
      policy.checksCollectionEligibility &&
      input.companyId &&
      input.invoiceId
    ) {
      const invoice = await this.prisma.invoice.findFirst({
        where: {
          id: input.invoiceId,
          companyId: input.companyId,
          status: 'PENDING',
        },
        select: { id: true },
      });
      const debtor = await this.prisma.debtor.findFirst({
        where: {
          id: input.debtorId,
          companyId: input.companyId,
          whatsappOptIn: true,
        },
        select: { id: true },
      });
      if (!invoice || !debtor) throw new Error('COLLECTION_NO_LONGER_ELIGIBLE');
    }
    const sender = await this.rates.checkRateLimit(
      `sender:${intent.transportChannelId}`,
      { maxMessages: 60, windowMs: 3_600_000 },
      intent.id,
    );
    if (!sender.allowed) this.wait(sender.resetAt);
    const recipient = await this.rates.checkRateLimit(
      input.phoneNumber,
      undefined,
      intent.id,
    );
    if (!recipient.allowed) this.wait(recipient.resetAt);
    await this.messaging.reserveDispatchQuota(
      intent.id,
      intent.transportChannelId,
      { commercial: policy.consumesCompanyQuota },
    );
  }

  private wait(resetAt: number): never {
    throw new WhatsappTransportError(
      'Envio pendente pelos limites do canal.',
      'RATE_LIMIT',
      'NOT_SENT',
      undefined,
      undefined,
      Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
    );
  }

  private async transmit(
    intent: CommunicationOutboundIntent,
    input: DispatchInput,
  ): Promise<AcceptedMessage> {
    if (input.messageType === 'text')
      return this.transport.sendText({
        to: input.phoneNumber,
        text: input.content,
        ...(input.replyToExternalMessageId
          ? { replyTo: input.replyToExternalMessageId }
          : {}),
      });
    const components: Record<string, unknown>[] = [];
    if (input.bodyParameters?.length)
      components.push({
        type: 'body',
        parameters: input.bodyParameters.map((text, index) => ({
          type: 'text',
          ...(input.bodyParameterNames
            ? { parameter_name: input.bodyParameterNames[index] }
            : {}),
          text,
        })),
      });
    const urlSuffix =
      input.buttonUrlSuffix ??
      (input.paymentButtonFromInvoice && input.companyId && input.invoiceId
        ? this.paymentLinks.createInvoicePaymentPage({
            companyId: input.companyId,
            invoiceId: input.invoiceId,
          }).token
        : null);
    if (urlSuffix)
      components.push({
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: urlSuffix }],
      });
    for (const index of input.quickReplyButtons ?? []) {
      // Persisted before transmission, so an immediate tap already resolves.
      const token = this.tokens.interactiveToken(intent.messageId, index);
      await this.prisma.communicationInteractiveReference.upsert({
        where: {
          messageId_buttonIndex: {
            messageId: intent.messageId,
            buttonIndex: index,
          },
        },
        create: {
          tokenHash: interactiveTokenHash(token),
          messageId: intent.messageId,
          buttonIndex: index,
        },
        update: {},
      });
      components.push({
        type: 'button',
        sub_type: 'quick_reply',
        index: String(index),
        parameters: [{ type: 'payload', payload: token }],
      });
    }
    return this.transport.sendTemplate({
      to: input.phoneNumber,
      name: input.templateName!,
      language: input.languageCode!,
      ...(components.length ? { components } : {}),
    });
  }

  private async recordAcceptance(
    tx: Prisma.TransactionClient,
    intent: CommunicationOutboundIntent,
    result: AcceptedMessage,
  ): Promise<void> {
    // Replies citing this message may have arrived before its provider ID was known.
    await reevaluateReplies(tx, intent.messageId);
    const input = this.payload(intent);
    const policy = dispatchPolicy(input);
    if (policy.consumesCompanyQuota && input.companyId)
      await tx.messagingUsage.upsert({
        where: {
          companyId_phoneNumber: {
            companyId: input.companyId,
            phoneNumber: input.phoneNumber,
          },
        },
        create: { companyId: input.companyId, phoneNumber: input.phoneNumber },
        update: { sentAt: new Date() },
      });
    if (!policy.recordsCollection || !input.companyId || !input.invoiceId)
      return;
    if (input.ruleStepId)
      await tx.collectionAttempt.upsert({
        where: {
          companyId_invoiceId_ruleStepId_channel: {
            companyId: input.companyId,
            invoiceId: input.invoiceId,
            ruleStepId: input.ruleStepId,
            channel: 'WHATSAPP',
          },
        },
        create: {
          companyId: input.companyId,
          invoiceId: input.invoiceId,
          ruleStepId: input.ruleStepId,
          channel: 'WHATSAPP',
          status: 'SENT',
          externalMessageId: result.messageId,
        },
        update: {
          status: 'SENT',
          externalMessageId: result.messageId,
          errorDetails: null,
        },
      });
    await tx.collectionLog.create({
      data: {
        companyId: input.companyId,
        invoiceId: input.invoiceId,
        actionType: 'WHATSAPP_SENT',
        description:
          'Solicitacao WhatsApp aceita pelo provedor; entrega acompanhada por webhook.',
        status: 'SENT',
      },
    });
  }

  @Interval(10_000)
  async recover(): Promise<void> {
    if (this.recovering) return;
    this.recovering = true;
    try {
      // Holds appear before the scheduled time; the claim check stays the guarantee.
      await this.pending.reconcileInvalidSnapshots(100);
      for (const intent of await this.intents.recover())
        await this.queue.addOutboundIntentJob(intent.id, intent.attempts);
    } catch {
      this.logger.warn('OUTBOUND_RECOVERY_DEFERRED');
    } finally {
      this.recovering = false;
    }
  }
}
