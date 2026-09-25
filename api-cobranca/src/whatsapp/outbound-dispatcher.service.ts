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
import { templateVariableNames } from '../templates/template-provider-state';

export interface DispatchPolicy {
  /** Invoice must still be pending and the debtor opted in, rechecked before transmission. */
  checksCollectionEligibility: boolean;
  /** A company may disable a template for its own collections. */
  honorsCompanyTemplatePreference: boolean;
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
    honorsCompanyTemplatePreference: !platformReply,
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
    return this.intents.execute(
      id,
      (intent) => this.validate(intent, this.payload(intent)),
      (intent) => this.transmit(intent, this.payload(intent)),
      (tx, intent, result) => this.recordAcceptance(tx, intent, result),
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
    } else await this.validateTemplate(input);
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

  private async validateTemplate(input: DispatchInput): Promise<void> {
    const template = await this.prisma.globalMessageTemplate.findFirst({
      where: {
        metaTemplateName: input.templateName,
        metaLanguage: input.languageCode,
      },
    });
    if (
      !template ||
      !template.isActive ||
      template.metaStatus !== 'APPROVED' ||
      template.metaReviewRequired
    )
      throw new WhatsappTransportError(
        'Template indisponivel. Sincronize e revise o catalogo administrativo.',
        'REJECTED',
        'NOT_SENT',
        undefined,
        undefined,
        undefined,
        'TEMPLATE_UNAVAILABLE',
      );
    const count = templateVariableNames(template.content).length;
    const paymentButton =
      Boolean(input.buttonUrlSuffix) ||
      (Boolean(input.paymentButtonFromInvoice) &&
        Boolean(input.companyId && input.invoiceId));
    if (
      input.bodyParameters?.length !== count ||
      input.bodyParameters.some((value) => !value.trim()) ||
      paymentButton !== template.paymentButtonEnabled ||
      !quickRepliesDeclared(template.metaComponents, input.quickReplyButtons)
    )
      throw new WhatsappTransportError(
        'Parametros incompativeis com o template aprovado.',
        'REJECTED',
        'NOT_SENT',
        undefined,
        undefined,
        undefined,
        'TEMPLATE_PARAMETERS_INVALID',
      );
    if (
      input.companyId &&
      dispatchPolicy(input).honorsCompanyTemplatePreference
    ) {
      const preference = await this.prisma.companyTemplatePreference.findUnique(
        {
          where: {
            companyId_channel_slug: {
              companyId: input.companyId,
              channel: 'WHATSAPP',
              slug: template.slug,
            },
          },
        },
      );
      if (preference?.isActive === false)
        throw new Error('COMPANY_TEMPLATE_DISABLED');
    }
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
        parameters: input.bodyParameters.map((text) => ({
          type: 'text',
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
      for (const intent of await this.intents.recover())
        await this.queue.addOutboundIntentJob(intent.id, intent.attempts);
    } catch {
      this.logger.warn('OUTBOUND_RECOVERY_DEFERRED');
    } finally {
      this.recovering = false;
    }
  }
}
