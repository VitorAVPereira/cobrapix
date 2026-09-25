import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  FINANCIAL_VALIDATION_QUEUE,
  FinancialValidationJob,
} from './financial-validation.jobs';
import { FinancialValidationService } from './financial-validation.service';

@Processor(FINANCIAL_VALIDATION_QUEUE, { concurrency: 2 })
export class FinancialValidationWorker extends WorkerHost {
  constructor(private readonly validation: FinancialValidationService) {
    super();
  }

  async process(job: Job<FinancialValidationJob>): Promise<void> {
    await this.validation.runAttempt(job.data.attemptId);
  }
}
