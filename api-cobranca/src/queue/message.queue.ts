import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
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

@Injectable()
export class MessageQueueService {
  constructor(
    @InjectQueue('whatsapp-messages')
    private readonly whatsappQueue: Queue<SendMessageJob>,
  ) {}

  async addSendMessageJob(job: SendMessageJob): Promise<void> {
    const minDelay = 1000;
    const maxDelay = 5000;
    const delay =
      Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;

    await this.whatsappQueue.add('send-message', job, {
      delay,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: {
        count: 1000,
        age: 24 * 3600,
      },
      removeOnFail: {
        count: 5000,
        age: 7 * 24 * 3600,
      },
    });
  }

  async addBulkSendMessageJobs(jobs: SendMessageJob[]): Promise<void> {
    const bulkJobs = jobs.map((job) => {
      const minDelay = 1000;
      const maxDelay = 5000;
      const baseDelay =
        Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;

      return {
        name: 'send-message',
        data: job,
        opts: {
          delay: baseDelay + jobs.indexOf(job) * 2000,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        },
      };
    });

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
}
