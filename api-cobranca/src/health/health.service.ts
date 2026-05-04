import { Injectable } from '@nestjs/common';
import { DatabaseHealthIndicator } from './indicators/database.indicator';
import { MetaHealthIndicator } from './indicators/meta.indicator';
import type { HealthCheckResult, OverallStatus } from './types';

@Injectable()
export class HealthService {
  constructor(
    private readonly database: DatabaseHealthIndicator,
    private readonly meta: MetaHealthIndicator,
  ) {}

  async runAll(): Promise<{
    overall: OverallStatus;
    checks: HealthCheckResult[];
  }> {
    const checks = [await this.database.check(), this.meta.check()];

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
