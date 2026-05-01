import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EfiService } from '../payment/efi.service';
import { getWhatsAppNumberLookupCandidates } from '../common/whatsapp-number';

interface EvolutionWebhookPayload {
  event: string;
  instance: string;
  data: {
    instance: string;
    state: 'open' | 'close' | 'connecting' | 'refused';
    statusReason?: number;
  };
  apikey?: string;
  server_url?: string;
  date_time?: string;
  sender?: string;
}

interface MetaWebhookPayload {
  object: 'whatsapp_business_account';
  entry: MetaWebhookEntry[];
}

interface MetaWebhookEntry {
  id: string;
  changes: Array<{
    field: string;
    value: {
      metadata?: {
        phone_number_id?: string;
      };
      messages?: MetaIncomingMessage[];
      statuses?: MetaMessageStatus[];
    };
  }>;
}

interface MetaIncomingMessage {
  from: string;
  type: string;
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
  ) {}

  async handleEvolutionWebhook(
    payload: unknown,
  ): Promise<{ updated?: boolean; status?: string; ignored?: boolean }> {
    if (!this.isEvolutionWebhookPayload(payload)) {
      this.logger.warn('Payload Evolution invalido');
      throw new Error('Payload invalido');
    }

    // So trata connection.update
    if (payload.event !== 'connection.update') {
      return { ignored: true, updated: false };
    }

    const instanceName = payload.instance;
    const state = payload.data?.state;

    if (!instanceName || !state) {
      this.logger.warn('Payload invalido: instance ou state ausente');
      throw new Error('Payload invalido: instance ou state ausente');
    }

    // Valida API key se configurada
    const expectedKey = this.configService.get<string>('EVOLUTION_API_KEY');
    if (expectedKey && payload.apikey !== expectedKey) {
      this.logger.warn(
        `Webhook Evolution: apikey invalida para instancia ${instanceName}`,
      );
      throw new Error('Nao autorizado');
    }

    // Busca a empresa dona da instancia
    const company = await this.prisma.company.findFirst({
      where: { whatsappInstanceId: instanceName },
    });

    if (!company) {
      this.logger.warn(
        `Webhook Evolution: instancia ${instanceName} nao pertence a nenhuma empresa`,
      );
      return { ignored: true, updated: false };
    }

    // Mapeia state da Evolution para WhatsappStatus do banco
    const newStatus =
      state === 'open'
        ? 'CONNECTED'
        : state === 'close' || state === 'refused'
          ? 'DISCONNECTED'
          : null; // "connecting" sem mudanca

    if (!newStatus || company.whatsappStatus === newStatus) {
      return { ignored: true, updated: false };
    }

    await this.prisma.company.update({
      where: { id: company.id },
      data: { whatsappStatus: newStatus },
    });

    this.logger.log(
      `Webhook Evolution: ${instanceName} -> ${state} -> status atualizado para ${newStatus}`,
    );

    return { updated: true, status: newStatus };
  }

  async handleEfiPixWebhook(payload: unknown): Promise<{
    processed: boolean;
    invoiceId?: string;
    status?: string;
  }> {
    return this.efiService.handlePixWebhook(payload);
  }

  async handleEfiChargesWebhook(payload: unknown): Promise<{
    processed: boolean;
    invoiceId?: string;
    status?: string;
  }> {
    return this.efiService.handleChargesWebhook(payload);
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
  }> {
    this.verifyMetaSignature(signature, rawBody);

    if (!this.isMetaWebhookPayload(payload)) {
      this.logger.warn('Payload Meta invalido');
      throw new Error('Payload invalido');
    }

    let statuses = 0;
    let optOuts = 0;

    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        if (change.field !== 'messages') {
          continue;
        }

        const phoneNumberId = change.value.metadata?.phone_number_id;
        if (!phoneNumberId) {
          continue;
        }

        const company = await this.prisma.company.findFirst({
          where: {
            whatsappProvider: 'META_CLOUD',
            metaPhoneNumberId: phoneNumberId,
          },
          select: { id: true },
        });

        if (!company) {
          this.logger.warn(
            `Webhook Meta ignorado: phone_number_id ${phoneNumberId} sem empresa`,
          );
          continue;
        }

        for (const status of change.value.statuses ?? []) {
          statuses++;
          this.logger.log(
            `Webhook Meta status ${status.status} para ${status.recipient_id ?? 'destinatario desconhecido'} (${status.id})`,
          );
        }

        for (const message of change.value.messages ?? []) {
          if (this.isOptOutMessage(message)) {
            const updated = await this.revokeDebtorOptIn(
              company.id,
              message.from,
            );
            optOuts += updated;
          }
        }
      }
    }

    return { processed: true, statuses, optOuts };
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

  private isEvolutionWebhookPayload(
    payload: unknown,
  ): payload is EvolutionWebhookPayload {
    if (!this.isRecord(payload) || !this.isRecord(payload.data)) {
      return false;
    }

    return (
      typeof payload.event === 'string' &&
      typeof payload.instance === 'string' &&
      typeof payload.data.instance === 'string' &&
      typeof payload.data.state === 'string'
    );
  }

  private isMetaWebhookPayload(payload: unknown): payload is MetaWebhookPayload {
    if (!this.isRecord(payload) || payload.object !== 'whatsapp_business_account') {
      return false;
    }

    return Array.isArray(payload.entry);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
