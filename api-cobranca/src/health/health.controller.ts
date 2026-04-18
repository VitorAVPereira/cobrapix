import { Controller, Get, Logger, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService } from './health.service';

/**
 * GET /health
 *
 * Contrato idêntico ao endpoint `/api/health` que existia no Next
 * (removido na mesma fatia de migração). Preserva:
 *   - body { status, timestamp, checks[] }
 *   - 200 OK quando healthy ou degraded
 *   - 503 quando unhealthy ou erro interno
 */
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly service: HealthService) {}

  // TODO(auth): aplicar @UseGuards(JwtAuthGuard) quando AuthModule existir.
  // Health check geralmente fica público, mas pode ficar atrás de IP allowlist.
  @Get()
  async get(@Res() res: Response): Promise<Response> {
    try {
      const { overall, checks } = await this.service.runAll();
      const statusCode = overall === 'unhealthy' ? 503 : 200;
      return res.status(statusCode).json({
        status: overall,
        timestamp: new Date().toISOString(),
        checks,
      });
    } catch (error) {
      this.logger.error(
        'Erro ao executar health check',
        error instanceof Error ? error.stack : undefined,
      );
      return res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Falha ao executar verificações de saúde',
      });
    }
  }
}
