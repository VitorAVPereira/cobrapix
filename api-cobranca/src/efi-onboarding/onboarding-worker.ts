import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import type { OnboardingJob } from './onboarding-jobs';
import { OnboardingWorkflow } from './onboarding-workflow';
import { OnboardingProvisioner } from './onboarding-provisioner';
import { OnboardingEvents } from './onboarding-events';
import { OnboardingMaintenance } from './onboarding-maintenance';
import { isEfiOpeningEnabled } from './efi-opening-capability';

@Processor('efi-onboarding', {
  concurrency: 3,
  limiter: { max: 20, duration: 60_000 },
})
export class OnboardingWorker extends WorkerHost {
  private readonly logger = new Logger(OnboardingWorker.name);
  constructor(
    private readonly workflow: OnboardingWorkflow,
    private readonly provisioner: OnboardingProvisioner,
    private readonly events: OnboardingEvents,
    private readonly maintenance: OnboardingMaintenance,
    private readonly config: ConfigService,
  ) {
    super();
  }
  async process(job: Job<OnboardingJob>): Promise<void> {
    if (!isEfiOpeningEnabled(this.config)) {
      // Completing the job leaves the onboarding row exactly as it was.
      this.logger.warn('EFI_OPENING_DISABLED_JOB_SKIPPED');
      return;
    }
    const { companyId, attempt } = job.data;
    switch (job.name) {
      case 'submit':
        return this.workflow.submit(companyId, Math.floor(attempt / 100));
      case 'provision':
        return this.provisioner.run(companyId, attempt);
      case 'reconcile':
        return this.events.reconcile(companyId);
      case 'remind':
        return this.maintenance.remind(companyId, attempt);
      default:
        throw new Error('EFI_UNKNOWN_JOB');
    }
  }
}
