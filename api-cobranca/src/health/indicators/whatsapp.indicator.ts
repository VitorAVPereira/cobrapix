import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { HealthCheckResult } from '../types';

/**
 * Local configuration of the WhatsApp channel (Datafy). Never calls the provider:
 * "healthy" means complete configuration, not a verified token or delivery.
 */
@Injectable()
export class WhatsappHealthIndicator {
  constructor(private readonly config: ConfigService) {}

  check(): HealthCheckResult {
    const configured = [
      'DATAFY_API_TOKEN',
      'DATAFY_WEBHOOK_SECRET',
      'DATAFY_WEBHOOK_BASE_URL',
      'META_PHONE_NUMBER_ID',
      'META_BUSINESS_ACCOUNT_ID',
    ].every((key) => Boolean(this.config.get<string>(key)?.trim()));
    return {
      service: 'WhatsApp via Datafy',
      status: configured ? 'healthy' : 'unhealthy',
      message: configured
        ? 'Datafy configurado; autenticacao e recebimento real sao verificados pelo teste de integracao.'
        : 'Configuracao Datafy incompleta.',
      details: {
        transport: 'DATAFY',
        configured,
        authentication: 'NOT_CHECKED',
        webhookSupported: true,
      },
    };
  }
}
