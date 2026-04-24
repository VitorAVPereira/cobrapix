import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type EvolutionConnectionState = 'open' | 'close' | 'connecting';

export interface EvolutionInstanceResult {
  qrCode: string | null;
  pairingCode: string | null;
  state: EvolutionConnectionState;
  raw: unknown;
}

export interface ConnectionStateResponse {
  state: EvolutionConnectionState;
  raw: unknown;
}

export interface SendTextResponse {
  key: {
    remoteJid: string;
    fromMe: boolean;
    id: string;
  };
  messageTimestamp: string;
  status: string;
}

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl =
      this.configService.get<string>('EVOLUTION_API_URL') ||
      'http://localhost:8080';
    this.apiKey = this.configService.getOrThrow<string>('EVOLUTION_API_KEY');
  }

  private async evolutionFetch(
    path: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const url = `${this.baseUrl.replace(/\/$/, '')}${path}`;

    return fetch(url, {
      ...options,
      signal: options.signal ?? AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/json',
        apikey: this.apiKey,
        ...options.headers,
      },
    });
  }

  async createInstance(instanceName: string): Promise<EvolutionInstanceResult> {
    const response = await this.evolutionFetch('/instance/create', {
      method: 'POST',
      body: JSON.stringify({
        instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
        webhook: {
          url: this.buildWebhookUrl('/webhooks/evolution'),
          webhook_by_events: false,
          webhook_base64: false,
          events: ['CONNECTION_UPDATE'],
        },
      }),
    });

    if (!response.ok && response.status !== 403) {
      const body = await this.readResponseBody(response);
      throw new Error(
        `Evolution API: falha ao criar instância (${response.status}): ${body}`,
      );
    }

    const payload = await this.parseJsonResponse(response);
    return this.normalizeInstanceResult(payload);
  }

  async connectInstance(
    instanceName: string,
  ): Promise<EvolutionInstanceResult> {
    const response = await this.evolutionFetch(
      `/instance/connect/${instanceName}`,
    );

    if (!response.ok) {
      const body = await this.readResponseBody(response);
      throw new Error(
        `Evolution API: falha ao obter QR code (${response.status}): ${body}`,
      );
    }

    const payload = await this.parseJsonResponse(response);
    return this.normalizeInstanceResult(payload);
  }

  async getConnectionState(
    instanceName: string,
  ): Promise<ConnectionStateResponse> {
    const response = await this.evolutionFetch(
      `/instance/connectionState/${instanceName}`,
    );

    if (!response.ok) {
      const body = await this.readResponseBody(response);
      throw new Error(
        `Evolution API: falha ao consultar status (${response.status}): ${body}`,
      );
    }

    const payload = await this.parseJsonResponse(response);
    return {
      state: this.extractState(payload),
      raw: payload,
    };
  }

  async sendTextMessage(
    instanceName: string,
    phoneNumber: string,
    text: string,
  ): Promise<SendTextResponse> {
    const response = await this.evolutionFetch(
      `/message/sendText/${instanceName}`,
      {
        method: 'POST',
        body: JSON.stringify({ number: phoneNumber, text }),
      },
    );

    if (!response.ok) {
      const body = await this.readResponseBody(response);
      throw new Error(
        `Evolution API: falha ao enviar mensagem (${response.status}): ${body}`,
      );
    }

    return response.json() as Promise<SendTextResponse>;
  }

  async logoutInstance(instanceName: string): Promise<void> {
    const response = await this.evolutionFetch(
      `/instance/logout/${instanceName}`,
      {
        method: 'DELETE',
      },
    );

    if (!response.ok) {
      const body = await this.readResponseBody(response);
      throw new Error(
        `Evolution API: falha ao desconectar (${response.status}): ${body}`,
      );
    }
  }

  private buildWebhookUrl(path: string): string {
    const baseUrl =
      this.configService.get<string>('EFI_WEBHOOK_BASE_URL') ??
      'http://localhost:3001';

    return `${baseUrl.replace(/\/$/, '')}${path}`;
  }

  private async parseJsonResponse(response: Response): Promise<unknown> {
    const body = await response.text();

    if (!body) {
      return null;
    }

    try {
      return JSON.parse(body) as unknown;
    } catch {
      this.logger.warn(
        `Evolution API retornou conteúdo não JSON em ${response.url}`,
      );
      return body;
    }
  }

  private async readResponseBody(response: Response): Promise<string> {
    const body = await this.parseJsonResponse(response);

    if (typeof body === 'string') {
      return body;
    }

    if (this.isRecord(body)) {
      const message = this.readString(body, 'message');
      if (message) {
        return message;
      }
    }

    return JSON.stringify(body);
  }

  private normalizeInstanceResult(payload: unknown): EvolutionInstanceResult {
    return {
      qrCode: this.extractQrCode(payload),
      pairingCode: this.extractPairingCode(payload),
      state: this.extractState(payload),
      raw: payload,
    };
  }

  private extractQrCode(payload: unknown): string | null {
    if (!this.isRecord(payload)) {
      return null;
    }

    const qrcode = payload.qrcode;
    if (this.isRecord(qrcode)) {
      const base64 = this.readString(qrcode, 'base64');
      if (base64) {
        return this.stripDataUri(base64);
      }
    }

    const candidates = [
      this.readString(payload, 'base64'),
      this.readString(payload, 'code'),
      this.readString(payload, 'qrCode'),
    ];

    for (const candidate of candidates) {
      if (candidate) {
        return this.stripDataUri(candidate);
      }
    }

    return null;
  }

  private extractPairingCode(payload: unknown): string | null {
    if (!this.isRecord(payload)) {
      return null;
    }

    const qrcode = payload.qrcode;
    if (this.isRecord(qrcode)) {
      const pairingCode = this.readString(qrcode, 'pairingCode');
      if (pairingCode) {
        return pairingCode;
      }
    }

    return this.readString(payload, 'pairingCode');
  }

  private extractState(payload: unknown): EvolutionConnectionState {
    const rawState = this.extractRawState(payload)?.toLowerCase();

    if (!rawState) {
      return 'connecting';
    }

    if (
      rawState === 'open' ||
      rawState === 'connected' ||
      rawState === 'online'
    ) {
      return 'open';
    }

    if (
      rawState === 'close' ||
      rawState === 'closed' ||
      rawState === 'disconnected' ||
      rawState === 'logout' ||
      rawState === 'refused'
    ) {
      return 'close';
    }

    return 'connecting';
  }

  private extractRawState(payload: unknown): string | null {
    if (!this.isRecord(payload)) {
      return null;
    }

    const instance = payload.instance;
    if (this.isRecord(instance)) {
      const instanceState =
        this.readString(instance, 'state') ??
        this.readString(instance, 'status') ??
        this.readString(instance, 'connectionStatus');

      if (instanceState) {
        return instanceState;
      }
    }

    return (
      this.readString(payload, 'state') ??
      this.readString(payload, 'status') ??
      this.readString(payload, 'connectionStatus')
    );
  }

  private stripDataUri(value: string): string {
    return value.replace(/^data:image\/[a-z]+;base64,/i, '');
  }

  private readString(
    record: Record<string, unknown>,
    key: string,
  ): string | null {
    const value = record[key];
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
