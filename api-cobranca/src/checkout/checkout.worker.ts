import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CheckoutOrdersService } from './checkout-orders.service';
import { CheckoutRecoveryService } from './checkout-recovery.service';
import { CheckoutCardService } from './checkout-card.service';
import { CheckoutWebhooksService } from './checkout-webhooks.service';

/**
 * Every write is conditional on the current status, so two API instances
 * running the same tick cannot confirm or expire an order twice.
 */
@Injectable()
export class CheckoutWorker {
  private readonly logger = new Logger(CheckoutWorker.name);
  constructor(
    private readonly orders: CheckoutOrdersService,
    private readonly webhooks: CheckoutWebhooksService,
    private readonly recovery: CheckoutRecoveryService,
    private readonly card: CheckoutCardService,
  ) {}

  // Seller notices are claimed row by row, so this is also safe on two instances.
  @Cron(CronExpression.EVERY_30_SECONDS, { waitForCompletion: true })
  async deliverWebhooks(): Promise<void> {
    await this.step('webhooks', () => this.webhooks.deliverDue());
  }

  @Cron(CronExpression.EVERY_MINUTE, { waitForCompletion: true })
  async tick(): Promise<void> {
    await this.step('uncertain', () => this.orders.reconcileUncertain());
    await this.step('expire', () => this.orders.expireOverdue());
    await this.step('card', () => this.card.reconcileDue());
    await this.step('card-close', () => this.card.closeOverdue());
    await this.step('kept-cards', () => this.card.wipeKeptCards());
    await this.step('abandoned', () => this.recovery.notifyAbandoned());
  }

  // Updates are conditional on anonymizedAt, so a second instance is harmless.
  @Cron('40 3 * * *', {
    timeZone: 'America/Sao_Paulo',
    waitForCompletion: true,
  })
  async anonymize(): Promise<void> {
    await this.step('anonymize', () => this.recovery.anonymize());
  }

  private async step(name: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch {
      // The Efí or the database may be down; the next tick tries again.
      this.logger.warn(`CHECKOUT_WORKER_STEP_FAILED ${name}`);
    }
  }
}
