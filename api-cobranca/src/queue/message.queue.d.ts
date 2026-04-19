import { Queue } from 'bullmq';
export interface SendMessageJob {
    invoiceId: string;
    companyId: string;
    phoneNumber: string;
    instanceName: string;
    message: string;
    debtorName: string;
    retryCount?: number;
}
export declare class MessageQueueService {
    private readonly whatsappQueue;
    constructor(whatsappQueue: Queue<SendMessageJob>);
    addSendMessageJob(job: SendMessageJob): Promise<void>;
    addBulkSendMessageJobs(jobs: SendMessageJob[]): Promise<void>;
    getQueueStats(): Promise<{
        waiting: number;
        active: number;
        completed: number;
        failed: number;
    }>;
}
