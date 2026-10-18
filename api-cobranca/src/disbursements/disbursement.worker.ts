import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DisbursementApprovalService } from './disbursement-approval.service';
import { DisbursementSenderService } from './disbursement-sender.service';

/**
 * Decisions run before deadlines, so a tap that arrived in time is never expired, and
 * sending runs right after the decision, so an approved batch is paid on the same tick.
 */
@Injectable()
export class DisbursementWorker {
  private readonly logger = new Logger(DisbursementWorker.name);
  constructor(
    private readonly approvals: DisbursementApprovalService,
    private readonly sender: DisbursementSenderService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS, { waitForCompletion: true })
  async tick(): Promise<void> {
    await this.step('decide', () => this.approvals.decideAwaiting());
    await this.step('send', () => this.sender.sendApproved());
    await this.step('reconcile', () => this.sender.reconcile());
    await this.step('complete', () => this.sender.completeFinished());
    await this.step('expire', () => this.approvals.expireOverdue());
    await this.step('release', () => this.approvals.releaseUnsent());
    await this.step('acks', () => this.approvals.sendAcks());
    await this.step('notices', () => this.approvals.notifyExpired());
    await this.step('failures', () => this.approvals.notifyFailures());
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
