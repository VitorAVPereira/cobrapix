import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RateLimitService } from '../services/rate-limit.service';
export declare class MessageWorkerService implements OnModuleInit, OnModuleDestroy {
    private configService;
    private prisma;
    private rateLimitService;
    private readonly logger;
    private worker;
    private readonly baseUrl;
    private readonly apiKey;
    constructor(configService: ConfigService, prisma: PrismaService, rateLimitService: RateLimitService);
    onModuleInit(): void;
    onModuleDestroy(): Promise<void>;
    private processJob;
    private sendMessageViaEvolution;
}
