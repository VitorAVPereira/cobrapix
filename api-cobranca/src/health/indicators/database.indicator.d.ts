import { PrismaService } from '../../prisma/prisma.service';
import type { HealthCheckResult } from '../types';
export declare class DatabaseHealthIndicator {
    private readonly prisma;
    constructor(prisma: PrismaService);
    check(): Promise<HealthCheckResult>;
}
