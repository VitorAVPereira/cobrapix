export type HealthStatus = 'healthy' | 'unhealthy' | 'unknown';
export type OverallStatus = 'healthy' | 'degraded' | 'unhealthy';
export interface HealthCheckResult {
    service: string;
    status: HealthStatus;
    message: string;
    latency?: number;
    details?: Record<string, unknown>;
}
