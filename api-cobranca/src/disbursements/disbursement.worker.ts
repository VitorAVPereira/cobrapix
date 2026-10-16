import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DisbursementApprovalService } from './disbursement-approval.service';

/** Decisions run before deadlines, so a tap that arrived in time is never expired. */
@Injectable()
export class DisbursementWorker {
  private readonly logger = new Logger(DisbursementWorker.name);
  constructor(private readonly approvals: DisbursementApprovalService) {}

  @Cron(CronExpression.EVERY_30_SECONDS, { waitForCompletion: true })
  async tick(): Promise<void> {
    await this.step('decide', () => this.approvals.decideAwaiting());
    await this.step('expire', () => this.approvals.expireOverdue());
    await this.step('release', () => this.approvals.releaseUnsent());
    await this.step('acks', () => this.approvals.sendAcks());
    await this.step('notices', () => this.approvals.notifyExpired());
  }

  private async step(name: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch {
      // One failing step never stops the others; no payment data in logs.
      this.logger.warn(`DISBURSEMENT_WORKER_STEP_FAILED ${name}`);
    }
  }
}
