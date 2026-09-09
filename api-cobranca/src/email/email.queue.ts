import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SendEmailJob } from './email.processor';

@Injectable()
export class EmailQueueService {
  constructor(
    @InjectQueue('email-messages')
    private readonly emailQueue: Queue<SendEmailJob>,
  ) {}

  async addJob(job: SendEmailJob): Promise<void> {
    await this.emailQueue.add('send-email', job, {
      delay: this.randomBetween(500, 2_000),
      jobId: this.buildJobId(job),
      attempts: 3,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: { count: 5000, age: 48 * 3600 },
      removeOnFail: { count: 10000, age: 14 * 24 * 3600 },
    });
  }

  async addBulk(jobs: SendEmailJob[]): Promise<void> {
    const bulkJobs = jobs.map((job) => ({
      name: 'send-email' as const,
      data: job,
      opts: {
        delay: this.randomBetween(500, 2_000),
        jobId: this.buildJobId(job),
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: { count: 5000, age: 48 * 3600 },
        removeOnFail: { count: 10000, age: 14 * 24 * 3600 },
      },
    }));

    await this.emailQueue.addBulk(bulkJobs);
  }

  async getStats() {
    const [waiting, active, completed, failed] = await Promise.all([
      this.emailQueue.getWaitingCount(),
      this.emailQueue.getActiveCount(),
      this.emailQueue.getCompletedCount(),
      this.emailQueue.getFailedCount(),
    ]);
    return { waiting, active, completed, failed };
  }

  private buildJobId(job: SendEmailJob): string {
    const stepKey = job.ruleStepId ?? 'test';

    return `email:${job.companyId}:${job.invoiceId}:${stepKey}:${job.email}`;
  }

  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
