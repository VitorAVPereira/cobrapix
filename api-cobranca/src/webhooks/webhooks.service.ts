import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EfiService } from '../payment/efi.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { MessagingLimitService } from '../queue/services/messaging-limit.service';
import { WhatsAppConversationService } from '../whatsapp/conversation.service';
import { getWhatsAppNumberLookupCandidates } from '../common/whatsapp-number';

interface MetaWebhookPayload {
  object: 'whatsapp_business_account';
  entry: MetaWebhookEntry[];
}

interface MetaWebhookEntry {
  id: string;
  changes: Array<{
    field: string;
    value: MetaWebhookChangeValue;
  }>;
}

interface MetaWebhookChangeValue {
  metadata?: {
    phone_number_id?: string;
  };
  messages?: MetaIncomingMessage[];
  statuses?: MetaMessageStatus[];
  messaging_limit?: string;
  event?: string;
  decision?: string;
  reason?: string;
}

interface MetaIncomingMessage {
  from: string;
  type: string;
  id?: string;
  timestamp?: string;
  text?: {
    body?: string;
  };
}

interface MetaMessageStatus {
  id: string;
  status: string;
  recipient_id?: string;
  timestamp?: string;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private readonly efiService: EfiService,
    private readonly messagingLimitService: MessagingLimitService,
    private readonly conversationService: WhatsAppConversationService,
    private readonly crypto: PaymentCryptoService,
  ) {}

  async handleEfiPixWebhook(payload: unknown): Promise<{
    processed: boolean;
    invoiceId?: string;
    status?: string;
  }> {
    return this.efiService.handlePixWebhook(payload);
  }

  async handleEfiChargesWebhook(
    payload: unknown,
    companyId?: string,
  ): Promise<{
    processed: boolean;
    invoiceId?: string;
    status?: string;
  }> {
    return this.efiService.handleChargesWebhook(payload, companyId);
  }

  verifyMetaWebhook(params: {
    mode?: string;
    verifyToken?: string;
    challenge?: string;
  }): string {
    const expectedToken = this.configService.get<string>(
      'META_WEBHOOK_VERIFY_TOKEN',
    );

    if (!expectedToken) {
      throw new Error('META_WEBHOOK_VERIFY_TOKEN nao configurado');
    }

    if (
      params.mode === 'subscribe' &&
      params.verifyToken === expectedToken &&
      params.challenge
    ) {
      return params.challenge;
    }

    throw new Error('Nao autorizado');
  }

  async handleMetaWebhook(
    payload: unknown,
    signature: string | undefined,
    rawBody: Buffer | undefined,
  ): Promise<{
    processed: boolean;
    statuses: number;
    optOuts: number;
    tierUpdates: number;
    accountUpdates: number;
  }> {
    this.verifyMetaSignature(signature, rawBody);

    if (!this.isMetaWebhookPayload(payload)) {
      this.logger.warn('Payload Meta invalido');
      throw new Error('Payload invalido');
    }

    let statuses = 0;
    let optOuts = 0;
    const tierUpdates = 0;
    const accountUpdates = 0;

    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        const phoneNumberId = change.value.metadata?.phone_number_id;
        if (!phoneNumberId) {
          continue;
        }

        if (
          phoneNumberId !==
          this.configService.get<string>('META_PHONE_NUMBER_ID')
        ) {
          this.logger.warn('Webhook Meta ignorado: remetente desconhecido');
          continue;
        }

        switch (change.field) {
          case 'messages':
            for (const status of change.value.statuses ?? []) {
              statuses++;
              await this.prisma.communicationMessage.updateMany({
                where: { externalMessageId: status.id },
                data: { status: status.status },
              });
            }

            for (const message of change.value.messages ?? []) {
              await this.recordGlobalInbound(message);
              if (this.isOptOutMessage(message)) optOuts++;
            }
            break;

          case 'messaging_limit':
            this.logger.log('Atualizacao de limite Meta recebida');
            break;

          case 'account_review_update':
            this.logger.log('Atualizacao de revisao Meta recebida');
            break;

          case 'account_update':
            this.logger.log('Atualizacao de conta Meta recebida');
            break;

          default:
            this.logger.debug(
              `Webhook Meta: campo nao tratado "${change.field}"`,
            );
        }
      }
    }

    return { processed: true, statuses, optOuts, tierUpdates, accountUpdates };
  }

  private async recordGlobalInbound(
    message: MetaIncomingMessage,
  ): Promise<void> {
    const recipient = message.from.replace(/\D/g, '');
    const recipientHash = createHash('sha256').update(recipient).digest('hex');
    const content = message.text?.body ?? '(midia/sem texto)';
    const receivedAt = message.timestamp
      ? new Date(Number(message.timestamp) * 1000)
      : new Date();
    const retentionExpiresAt = new Date(receivedAt);
    retentionExpiresAt.setUTCFullYear(retentionExpiresAt.getUTCFullYear() + 5);
    const serviceWindowExpiresAt = new Date(
      receivedAt.getTime() + 24 * 60 * 60 * 1000,
    );
    const conversation = await this.prisma.communicationConversation.upsert({
      where: { channel_recipientHash: { channel: 'WHATSAPP', recipientHash } },
      create: {
        channel: 'WHATSAPP',
        recipientHash,
        recipientEncrypted: this.crypto.encrypt(recipient),
        lastInboundAt: receivedAt,
        serviceWindowExpiresAt,
        lastMessagePreview: content.slice(0, 255),
        unreadCount: 1,
        retentionExpiresAt,
      },
      update: {
        lastInboundAt: receivedAt,
        serviceWindowExpiresAt,
        lastMessagePreview: content.slice(0, 255),
        unreadCount: { increment: 1 },
        retentionExpiresAt,
      },
      select: { id: true },
    });
    await this.prisma.communicationMessage.upsert({
      where: {
        externalMessageId:
          message.id ?? `meta:${recipientHash}:${receivedAt.getTime()}`,
      },
      create: {
        conversationId: conversation.id,
        direction: 'INBOUND',
        content,
        externalMessageId: message.id,
        status: 'received',
        retentionExpiresAt,
      },
      update: { status: 'received' },
    });
  }

  private async recordMessageInteraction(
    companyId: string,
    status: MetaMessageStatus,
  ): Promise<void> {
    try {
      await this.messagingLimitService.recordInteraction({
        companyId,
        phoneNumber: status.recipient_id ?? 'unknown',
        direction: 'OUTBOUND',
        status: status.status,
        messageId: status.id,
        rawPayload: status,
      });
    } catch (error) {
      this.logger.error(
        `Falha ao registrar interacao de mensagem: ${String(error)}`,
      );
    }
  }

  private async recordInboundInteraction(
    companyId: string,
    message: MetaIncomingMessage,
  ): Promise<void> {
    try {
      await this.messagingLimitService.recordInteraction({
        companyId,
        phoneNumber: message.from,
        direction: 'INBOUND',
        status: 'received',
        messageId: message.id,
        rawPayload: message,
      });

      const content = message.text?.body ?? '(midia/sem texto)';

      await this.conversationService.handleInboundMessage({
        companyId,
        phoneNumber: message.from,
        messageId: message.id,
        content,
        timestamp: message.timestamp,
      });
    } catch (error) {
      this.logger.error(
        `Falha ao registrar interacao inbound: ${String(error)}`,
      );
    }
  }

  private async handleMessagingLimitUpdate(
    companyId: string,
    value: MetaWebhookChangeValue,
  ): Promise<number> {
    const rawTier = value.messaging_limit ?? value.event;
    if (!rawTier) return 0;

    const tier = this.messagingLimitService.normalizeTier(rawTier);
    if (!tier) {
      this.logger.warn(
        `Tier de mensagens desconhecido para ${companyId}: ${rawTier}`,
      );
      return 0;
    }

    await this.messagingLimitService.updateTierFromWebhook(companyId, tier);
    return 1;
  }

  private async handleAccountUpdate(
    companyId: string,
    value: MetaWebhookChangeValue,
  ): Promise<number> {
    if (value.event === 'RESTRICTED' || value.event === 'DISABLED') {
      await this.prisma.company.update({
        where: { id: companyId },
        data: { whatsappStatus: 'DISCONNECTED' },
      });
      this.logger.warn(
        `WABA da empresa ${companyId} ${value.event}: ${value.reason ?? 'sem motivo especificado'}`,
      );
      return 1;
    }

    return 0;
  }

  private verifyMetaSignature(
    signature: string | undefined,
    rawBody: Buffer | undefined,
  ): void {
    const appSecret = this.configService.get<string>('META_APP_SECRET');

    if (!appSecret) {
      return;
    }

    if (!signature || !rawBody) {
      throw new Error('Nao autorizado');
    }

    const digest = createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');
    const expected = Buffer.from(`sha256=${digest}`, 'utf8');
    const received = Buffer.from(signature, 'utf8');

    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new Error('Nao autorizado');
    }
  }

  private async revokeDebtorOptIn(
    companyId: string,
    phoneNumber: string,
  ): Promise<number> {
    const candidates = getWhatsAppNumberLookupCandidates(phoneNumber);
    const result = await this.prisma.debtor.updateMany({
      where: {
        companyId,
        phoneNumber: { in: candidates },
      },
      data: {
        whatsappOptIn: false,
        whatsappOptInAt: null,
        whatsappOptInSource: 'meta_webhook_opt_out',
      },
    });

    return result.count;
  }

  private isOptOutMessage(message: MetaIncomingMessage): boolean {
    const body = message.text?.body?.trim().toUpperCase();

    return (
      message.type === 'text' &&
      (body === 'STOP' ||
        body === 'SAIR' ||
        body === 'PARAR' ||
        body === 'CANCELAR')
    );
  }

  private isMetaWebhookPayload(
    payload: unknown,
  ): payload is MetaWebhookPayload {
    if (
      !this.isRecord(payload) ||
      payload.object !== 'whatsapp_business_account'
    ) {
      return false;
    }

    return Array.isArray(payload.entry);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
