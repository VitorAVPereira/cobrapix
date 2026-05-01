import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { HealthCheckResult } from '../types';

/**
 * Mantem o nome da classe por compatibilidade interna, mas o check principal
 * agora acompanha a configuracao da Meta Cloud API.
 */
@Injectable()
export class EvolutionHealthIndicator {
  constructor(private readonly config: ConfigService) {}

  async check(): Promise<HealthCheckResult> {
    const verifyToken = this.config.get<string>('META_WEBHOOK_VERIFY_TOKEN');
    const appSecret = this.config.get<string>('META_APP_SECRET');
    const graphVersion = this.config.get<string>(
      'META_GRAPH_API_VERSION',
      'v23.0',
    );

    if (!verifyToken) {
      return {
        service: 'Meta Cloud API',
        status: 'unhealthy',
        message: 'META_WEBHOOK_VERIFY_TOKEN nao configurado',
        details: { graphVersion },
      };
    }

    return {
      service: 'Meta Cloud API',
      status: 'healthy',
      message: appSecret
        ? 'Webhook Meta configurado com assinatura'
        : 'Webhook Meta configurado sem validacao de assinatura',
      details: {
        graphVersion,
        signatureValidation: Boolean(appSecret),
      },
    };
  }
}
