import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
interface EvolutionWebhookPayload {
    event: string;
    instance: string;
    data: {
        instance: string;
        state: 'open' | 'close' | 'connecting' | 'refused';
        statusReason?: number;
    };
    apikey?: string;
    server_url?: string;
    date_time?: string;
    sender?: string;
}
export declare class WebhooksService {
    private configService;
    private prisma;
    private readonly logger;
    constructor(configService: ConfigService, prisma: PrismaService);
    handleEvolutionWebhook(payload: EvolutionWebhookPayload): Promise<{
        updated?: boolean;
        status?: string;
        ignored?: boolean;
    }>;
    handleAsaasWebhook(payload: any): Promise<{
        processed: boolean;
        invoiceId?: string;
        status?: string;
    }>;
}
export {};
