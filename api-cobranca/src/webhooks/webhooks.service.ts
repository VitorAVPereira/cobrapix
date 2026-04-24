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
