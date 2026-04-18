import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface CreateInstanceResponse {
  instance: {
    instanceName: string;
    instanceId: string;
    status: string;
  };
  hash: {
    apikey: string;
  };
}

export interface ConnectInstanceResponse {
  pairingCode?: string;
  code: string;
  count: number;
}

export interface ConnectionStateResponse {
  instance: {
    state: 'open' | 'close' | 'connecting';
  };
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

  constructor(private configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('EVOLUTION_API_URL') || 'http://localhost:8080';
    this.apiKey = this.configService.getOrThrow<string>('EVOLUTION_API_KEY');
  }

  private async evolutionFetch(path: string, options: RequestInit = {}): Promise<Response> {
    const url = `${this.baseUrl}/api/v1${path}`;

    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        apikey: this.apiKey,
        ...options.headers,
      },
    });

    return res;
  }

  async createInstance(instanceName: string): Promise<CreateInstanceResponse> {
    const webhookUrl = this.configService.get<string>('EVOLUTION_WEBHOOK_URL') || 
      `${this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000'}/webhooks/evolution`;

    const res = await this.evolutionFetch('/instance/create', {
      method: 'POST',
      body: JSON.stringify({
        instanceName,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
        webhook: {
          url: webhookUrl,
          webhook_by_events: false,
          webhook_base64: false,
          events: ['CONNECTION_UPDATE'],
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Evolution API: falha ao criar instância (${res.status}): ${body}`);
    }

    return res.json();
  }

  async connectInstance(instanceName: string): Promise<ConnectInstanceResponse> {
    const res = await this.evolutionFetch(`/instance/connect/${instanceName}`);

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Evolution API: falha ao obter QR code (${res.status}): ${body}`);
    }

    return res.json();
  }

  async getConnectionState(instanceName: string): Promise<ConnectionStateResponse> {
    const res = await this.evolutionFetch(`/instance/connectionState/${instanceName}`);

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Evolution API: falha ao consultar status (${res.status}): ${body}`);
    }

    return res.json();
  }

  async sendTextMessage(instanceName: string, phoneNumber: string, text: string): Promise<SendTextResponse> {
    const res = await this.evolutionFetch(`/message/sendText/${instanceName}`, {
      method: 'POST',
      body: JSON.stringify({ number: phoneNumber, text }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Evolution API: falha ao enviar mensagem (${res.status}): ${body}`);
    }

    return res.json();
  }

  async logoutInstance(instanceName: string): Promise<void> {
    const res = await this.evolutionFetch(`/instance/logout/${instanceName}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Evolution API: falha ao desconectar (${res.status}): ${body}`);
    }
  }
}
