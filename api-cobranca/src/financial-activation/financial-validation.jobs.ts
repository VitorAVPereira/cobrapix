import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export const FINANCIAL_VALIDATION_QUEUE = 'financial-validation';

// Jobs carry identifiers only. The database row is the source of truth; a
// lost job is picked up again by the recovery routine.
export interface FinancialValidationJob {
  attemptId: string;
}

@Injectable()
export class FinancialValidationJobs {
  private readonly logger = new Logger(FinancialValidationJobs.name);

  constructor(
    @InjectQueue(FINANCIAL_VALIDATION_QUEUE)
    private readonly queue: Queue<FinancialValidationJob>,
  ) {}

  async enqueue(attemptId: string, run: number, delay = 0): Promise<void> {
    try {
      await this.queue.add(
        'validate',
        { attemptId },
        {
          jobId: `fv-${attemptId}-${run}`,
          delay,
          attempts: 1,
          removeOnComplete: { age: 7 * 86400, count: 10000 },
          removeOnFail: { age: 30 * 86400, count: 10000 },
        },
      );
    } catch {
      // Redis unavailable: the recovery routine runs the attempt from the database.
      this.logger.warn('FINANCIAL_VALIDATION_ENQUEUE_FAILED');
    }
  }
}
