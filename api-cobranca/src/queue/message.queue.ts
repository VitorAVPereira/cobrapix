import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CollectionChannel } from '@prisma/client';

const SAFE_SINGLE_MIN_DELAY_MS = 1_000;
const SAFE_SINGLE_MAX_DELAY_MS = 3_000;
const SAFE_BULK_INTERVAL_MS = 500;
const SAFE_BULK_JITTER_MS = 1_000;

export interface SendMessageJob {
  invoiceId: string;
  companyId: string;
  debtorId: string;
  phoneNumber: string;
  senderKey: string;
  templateName: string;
  templateLanguage: string;
  templateParameters: string[];
  buttonUrlSuffix?: string;
  message?: string;
  debtorName: string;
  retryCount?: number;
  ruleStepId?: string;
}

export interface InitialChargeJob {
  invoiceId: string;
  companyId: string;
  source: 'MANUAL' | 'CSV' | 'RECURRING' | 'SELECTED';
  channels?: CollectionChannel[];
  /** Manual re-send request: each one is its own WhatsApp communication. */
  requestId?: string;
}

export interface OutboundIntentJob {
  intentId: string;
}
export type WhatsAppQueueJob =
  | SendMessageJob
  | InitialChargeJob
  | OutboundIntentJob;

@Injectable()
export class MessageQueueService {
  constructor(
    @InjectQueue('whatsapp-messages')
    private readonly whatsappQueue: Queue<WhatsAppQueueJob>,
  ) {}

  async addOutboundIntentJob(intentId: string, attempt = 0): Promise<void> {
    await this.whatsappQueue.add(
      'outbound-intent',
      { intentId },
      {
        ...this.buildJobOptions(`outbound-${intentId}-${attempt}`),
        removeOnComplete: true,
      },
    );
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
      data: { ...job, requestId: String(requestedAt) },
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
      jobId: this.sanitizeJobId(jobId),
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

  private sanitizeJobId(jobId: string): string {
    return jobId.replace(/:/g, '_');
  }

  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
