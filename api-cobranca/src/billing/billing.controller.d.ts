import { BillingService } from './billing.service';
import { PrismaService } from '../prisma/prisma.service';
export declare class BillingController {
    private readonly billingService;
    private readonly prisma;
    constructor(billingService: BillingService, prisma: PrismaService);
    runBilling(user: any): Promise<{
        success: boolean;
        summary: {
            total: number;
            queued: number;
            skipped: number;
        };
        message: string;
    }>;
}
