import { Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RateLimitService } from '../services/rate-limit.service';
export declare class MessageProcessor {
    private configService;
    private prisma;
    private rateLimitService;
    private readonly logger;
    private readonly baseUrl;
    private readonly apiKey;
    constructor(configService: ConfigService, prisma: PrismaService, rateLimitService: RateLimitService);
    handleSendMessage(job: Job): Promise<void>;
    private sendMessageViaEvolution;
}
