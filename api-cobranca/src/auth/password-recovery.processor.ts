import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AuthService, PasswordRecoveryJob } from './auth.service';

@Processor('auth-password-recovery')
export class PasswordRecoveryProcessor extends WorkerHost {
  constructor(private readonly authService: AuthService) {
    super();
  }

  async process(job: Job<PasswordRecoveryJob>): Promise<void> {
    if (job.name !== 'send-password-reset') {
      return;
    }

    await this.authService.processPasswordRecovery(
      job.data.email,
      job.data.requestId,
    );
  }
}
