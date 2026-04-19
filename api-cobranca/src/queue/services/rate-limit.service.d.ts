import { ConfigService } from '@nestjs/config';
export interface RateLimitConfig {
    maxMessages: number;
    windowMs: number;
}
export declare class RateLimitService {
    private configService;
    private readonly logger;
    private redis;
    private readonly defaultConfig;
    constructor(configService: ConfigService);
    checkRateLimit(phoneNumber: string, config?: Partial<RateLimitConfig>): Promise<{
        allowed: boolean;
        remaining: number;
        resetAt: number;
    }>;
    getTimeUntilNextMessage(phoneNumber: string): Promise<number>;
    onModuleDestroy(): Promise<void>;
}
