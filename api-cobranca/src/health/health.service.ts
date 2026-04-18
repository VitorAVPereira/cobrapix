import { Injectable } from '@nestjs/common';
import { DatabaseHealthIndicator } from './indicators/database.indicator';
import { EvolutionHealthIndicator } from './indicators/evolution.indicator';
import type { HealthCheckResult, OverallStatus } from './types';

/**
 * Orquestra todos os indicadores e agrega o estado geral da aplicação.
 * - `healthy`: todos os checks passaram.
 * - `degraded`: pelo menos um passou e pelo menos um falhou.
 * - `unhealthy`: todos falharam.
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly database: DatabaseHealthIndicator,
    private readonly evolution: EvolutionHealthIndicator,
  ) {}

  async runAll(): Promise<{
    overall: OverallStatus;
    checks: HealthCheckResult[];
  }> {
    const checks = await Promise.all([
      this.database.check(),
      this.evolution.check(),
    ]);

    const allHealthy = checks.every((c) => c.status === 'healthy');
    const someHealthy = checks.some((c) => c.status === 'healthy');

    const overall: OverallStatus = allHealthy
      ? 'healthy'
      : someHealthy
        ? 'degraded'
        : 'unhealthy';

    return { overall, checks };
  }
}
