import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EfiService } from '../payment/efi.service';

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
      this.logger.warn(`Webhook Evolution: apikey invalida para instancia ${instanceName}`);
      throw new Error('Nao autorizado');
    }

    // Busca a empresa dona da instancia
    const company = await this.prisma.company.findFirst({
      where: { whatsappInstanceId: instanceName },
    });

    if (!company) {
      this.logger.warn(`Webhook Evolution: instancia ${instanceName} nao pertence a nenhuma empresa`);
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

    this.logger.log(`Webhook Evolution: ${instanceName} -> ${state} -> status atualizado para ${newStatus}`);

    return { updated: true, status: newStatus };
  }

  async handleAsaasWebhook(
    payload: unknown,
  ): Promise<{ processed: boolean; invoiceId?: string; status?: string }> {
    if (!this.isRecord(payload)) {
      return { processed: false };
    }

    const event = typeof payload.event === 'string' ? payload.event : null;
    const payment = typeof payload.payment === 'string' ? payload.payment : null;
    const status = typeof payload.status === 'string' ? payload.status : null;

    if (!payment) {
      this.logger.warn('Webhook Asaas: payment nao presente no payload');
      return { processed: false };
    }

    if (!event || !event.startsWith('PAYMENT_')) {
      this.logger.log(`Webhook Asaas: evento ignorado - ${event}`);
      return { processed: false };
    }

    const invoice = await this.prisma.invoice.findFirst({
      where: { gatewayId: payment },
    });

    if (!invoice) {
      this.logger.warn(`Webhook Asaas: fatura nao encontrada para gatewayId ${payment}`);
      return { processed: false };
    }

    let newStatus: 'PENDING' | 'PAID' | 'CANCELED' | null = null;

    if (status === 'CONFIRMED' || status === 'RECEIVED' || status === 'PAID') {
      newStatus = 'PAID';
    } else if (status === 'CANCELED' || status === 'EXPIRED' || status === 'REJECTED') {
      newStatus = 'CANCELED';
    }

    if (!newStatus) {
      this.logger.log(`Webhook Asaas: status ${status} nao requer atualizacao`);
      return { processed: false };
    }

    if (invoice.status === newStatus) {
      this.logger.log(`Webhook Asaas: fatura ${invoice.id} ja esta com status ${newStatus}`);
      return { processed: true, invoiceId: invoice.id, status: newStatus };
    }

    await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: newStatus },
    });

    await this.prisma.collectionLog.create({
      data: {
        companyId: invoice.companyId,
        invoiceId: invoice.id,
        actionType: 'PAYMENT_WEBHOOK',
        description: `Pagamento atualizado via webhook: ${event} - ${status}`,
        status: newStatus,
      },
    });

    this.logger.log(`Webhook Asaas: fatura ${invoice.id} atualizada para ${newStatus} (evento: ${event})`);

    return { processed: true, invoiceId: invoice.id, status: newStatus };
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

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
