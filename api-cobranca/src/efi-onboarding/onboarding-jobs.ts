import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export type OnboardingJobKind = 'submit' | 'provision' | 'remind' | 'reconcile';
export interface OnboardingJob {
  companyId: string;
  attempt: number;
}
@Injectable()
export class OnboardingJobs {
  constructor(
    @InjectQueue('efi-onboarding') private readonly queue: Queue<OnboardingJob>,
  ) {}
  async schedule(
    companyId: string,
    kind: OnboardingJobKind,
    attempt = 0,
    delay = 0,
    recover = false,
  ): Promise<void> {
    const jobId = `efi-${kind}-${companyId}-${attempt}`;
    if (recover) {
      const existing = await this.queue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (state !== 'completed' && state !== 'failed') return;
        await existing.remove();
      }
    }
    await this.queue.add(
      kind,
      { companyId, attempt },
      {
        jobId,
        delay,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: { age: 7 * 86400, count: 10000 },
        removeOnFail: { age: 30 * 86400, count: 10000 },
      },
    );
  }
}
