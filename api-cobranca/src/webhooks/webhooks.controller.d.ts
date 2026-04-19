import { WebhooksService } from './webhooks.service';
export declare class WebhooksController {
    private readonly webhooksService;
    private readonly logger;
    constructor(webhooksService: WebhooksService);
    handleEvolutionWebhook(payload: any): Promise<{
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
