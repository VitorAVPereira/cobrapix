import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { HealthCheckResult } from '../types';

/**
 * Verifica a configuracao da Meta Cloud API (webhook, Graph API).
 */
@Injectable()
export class MetaHealthIndicator {
  constructor(private readonly config: ConfigService) {}

  check(): HealthCheckResult {
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
