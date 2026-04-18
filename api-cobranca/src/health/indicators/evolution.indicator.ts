import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { HealthCheckResult } from '../types';

/**
 * Verifica se a Evolution API (container Docker) está respondendo.
 * Timeout de 5s evita que um container lento trave o health check do Nest.
 */
@Injectable()
export class EvolutionHealthIndicator {
  private readonly url: string;

  constructor(config: ConfigService) {
    this.url = config.get<string>(
      'EVOLUTION_API_URL',
      'http://localhost:8080',
    );
  }

  async check(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      const response = await fetch(`${this.url}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      const latency = Date.now() - startTime;

      if (response.ok) {
        return {
          service: 'Evolution API',
          status: 'healthy',
          message: 'Evolution API está respondendo',
          latency,
        };
      }

      return {
        service: 'Evolution API',
        status: 'unhealthy',
        message: `Evolution API retornou status ${response.status}`,
        latency,
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Erro desconhecido';
      return {
        service: 'Evolution API',
        status: 'unhealthy',
        message: `Falha ao conectar com Evolution API: ${errorMessage}`,
        latency,
        details: { error: errorMessage },
      };
    }
  }
}
