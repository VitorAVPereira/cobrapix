import { PrismaService } from '../prisma/prisma.service';
import { MessageQueueService } from '../queue/message.queue';
import { SpintaxService } from '../queue/services/spintax.service';
export declare class BillingService {
    private prisma;
    private messageQueue;
    private spintaxService;
    private readonly logger;
    private isRunning;
    constructor(prisma: PrismaService, messageQueue: MessageQueueService, spintaxService: SpintaxService);
    runScheduledBilling(): Promise<void>;
    executeBilling(companyId: string): Promise<{
        queued: number;
        skipped: number;
    }>;
    private queueBillingForCompany;
}
