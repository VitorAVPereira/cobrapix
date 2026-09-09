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
  ): Promise<void> {
    await this.queue.add(
      kind,
      { companyId, attempt },
      {
        jobId: `efi-${kind}-${companyId}-${attempt}`,
        delay,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: { age: 7 * 86400, count: 10000 },
        removeOnFail: { age: 30 * 86400, count: 10000 },
      },
    );
  }
}
