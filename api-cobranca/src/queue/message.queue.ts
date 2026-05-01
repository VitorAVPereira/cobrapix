import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

const SAFE_SINGLE_MIN_DELAY_MS = 15_000;
const SAFE_SINGLE_MAX_DELAY_MS = 45_000;
const SAFE_BULK_INTERVAL_MS = 30_000;
const SAFE_BULK_JITTER_MS = 15_000;

export interface SendMessageJob {
  invoiceId: string;
  companyId: string;
  debtorId: string;
  phoneNumber: string;
  senderKey: string;
  templateName: string;
  templateLanguage: string;
  templateParameters: string[];
  message?: string;
  debtorName: string;
  retryCount?: number;
}

export interface InitialChargeJob {
  invoiceId: string;
  companyId: string;
  source: 'MANUAL' | 'CSV' | 'RECURRING' | 'SELECTED';
}

export type WhatsAppQueueJob = SendMessageJob | InitialChargeJob;

@Injectable()
export class MessageQueueService {
  constructor(
    @InjectQueue('whatsapp-messages')
    private readonly whatsappQueue: Queue<WhatsAppQueueJob>,
  ) {}

  async addSendMessageJob(job: SendMessageJob): Promise<void> {
    await this.whatsappQueue.add('send-message', job, {
      delay: this.buildSafeDelay(0),
      ...this.buildJobOptions(`send-message:${job.companyId}:${job.invoiceId}`),
    });
  }

  async addBulkSendMessageJobs(jobs: SendMessageJob[]): Promise<void> {
    const bulkJobs = jobs.map((job, index) => ({
      name: 'send-message',
      data: job,
      opts: {
        delay: this.buildSafeDelay(index),
        ...this.buildJobOptions(
          `send-message:${job.companyId}:${job.invoiceId}`,
        ),
      },
    }));

    await this.whatsappQueue.addBulk(bulkJobs);
  }

  async addInitialChargeJobs(jobs: InitialChargeJob[]): Promise<void> {
    const bulkJobs = jobs.map((job, index) => ({
      name: 'initial-charge',
      data: job,
      opts: {
        delay: this.buildSafeDelay(index),
        ...this.buildJobOptions(
          `initial-charge:${job.companyId}:${job.invoiceId}`,
        ),
      },
    }));

    await this.whatsappQueue.addBulk(bulkJobs);
  }

  async addSelectedInitialChargeJobs(jobs: InitialChargeJob[]): Promise<void> {
    const requestedAt = Date.now();
    const bulkJobs = jobs.map((job, index) => ({
      name: 'initial-charge',
      data: job,
      opts: {
        delay: this.buildSafeDelay(index),
        ...this.buildJobOptions(
          `initial-charge-selected:${job.companyId}:${job.invoiceId}:${requestedAt}`,
        ),
      },
    }));

    await this.whatsappQueue.addBulk(bulkJobs);
  }

  async getQueueStats() {
    const [waiting, active, completed, failed] = await Promise.all([
      this.whatsappQueue.getWaitingCount(),
      this.whatsappQueue.getActiveCount(),
      this.whatsappQueue.getCompletedCount(),
      this.whatsappQueue.getFailedCount(),
    ]);

    return { waiting, active, completed, failed };
  }

  private buildSafeDelay(index: number): number {
    const baseDelay = this.randomBetween(
      SAFE_SINGLE_MIN_DELAY_MS,
      SAFE_SINGLE_MAX_DELAY_MS,
    );
    const jitter = this.randomBetween(0, SAFE_BULK_JITTER_MS);

    return baseDelay + index * SAFE_BULK_INTERVAL_MS + jitter;
  }

  private buildJobOptions(jobId: string): {
    jobId: string;
    attempts: number;
    backoff: {
      type: 'exponential';
      delay: number;
    };
    removeOnComplete: {
      count: number;
      age: number;
    };
    removeOnFail: {
      count: number;
      age: number;
    };
  } {
    return {
      jobId,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 60_000,
      },
      removeOnComplete: {
        count: 1000,
        age: 24 * 3600,
      },
      removeOnFail: {
        count: 5000,
        age: 7 * 24 * 3600,
      },
    };
  }

  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
