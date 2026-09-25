import { Injectable } from '@nestjs/common';
import { DatabaseHealthIndicator } from './indicators/database.indicator';
import { WhatsappHealthIndicator } from './indicators/whatsapp.indicator';
import { CommunicationMediaHealthIndicator } from './indicators/communication-media.indicator';
import type { HealthCheckResult, OverallStatus } from './types';

@Injectable()
export class HealthService {
  constructor(
    private readonly database: DatabaseHealthIndicator,
    private readonly whatsapp: WhatsappHealthIndicator,
    private readonly media: CommunicationMediaHealthIndicator,
  ) {}

  async runAll(): Promise<{
    overall: OverallStatus;
    checks: HealthCheckResult[];
  }> {
    const core = [await this.database.check(), this.whatsapp.check()];
    // Advisory: attachment storage can degrade the status but never mask a core failure.
    const advisory = [await this.media.check()];

    const allHealthy = core.every((c) => c.status === 'healthy');
    const someHealthy = core.some((c) => c.status === 'healthy');

    const overall: OverallStatus = allHealthy
      ? advisory.every((c) => c.status === 'healthy')
        ? 'healthy'
        : 'degraded'
      : someHealthy
        ? 'degraded'
        : 'unhealthy';

    return { overall, checks: [...core, ...advisory] };
  }
}
