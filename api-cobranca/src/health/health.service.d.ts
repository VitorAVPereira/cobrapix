import { DatabaseHealthIndicator } from './indicators/database.indicator';
import { EvolutionHealthIndicator } from './indicators/evolution.indicator';
import type { HealthCheckResult, OverallStatus } from './types';
export declare class HealthService {
    private readonly database;
    private readonly evolution;
    constructor(database: DatabaseHealthIndicator, evolution: EvolutionHealthIndicator);
    runAll(): Promise<{
        overall: OverallStatus;
        checks: HealthCheckResult[];
    }>;
}
