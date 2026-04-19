import { ConfigService } from '@nestjs/config';
import type { HealthCheckResult } from '../types';
export declare class EvolutionHealthIndicator {
    private readonly url;
    constructor(config: ConfigService);
    check(): Promise<HealthCheckResult>;
}
