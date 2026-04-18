import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { HealthCheckResult } from '../types';

/**
 * Verifica se o banco de dados está acessível via Prisma.
 * Query `SELECT 1` é a mais barata possível e suficiente para validar
 * que o adapter Neon + WebSocket estão funcionais.
 */
@Injectable()
export class DatabaseHealthIndicator {
  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        service: 'Database',
        status: 'healthy',
        message: 'Banco de dados está respondendo',
        latency: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Erro desconhecido';
      return {
        service: 'Database',
        status: 'unhealthy',
        message: `Falha ao conectar com banco de dados: ${errorMessage}`,
        latency: Date.now() - startTime,
        details: { error: errorMessage },
      };
    }
  }
}
