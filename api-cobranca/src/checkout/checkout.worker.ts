import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CheckoutOrdersService } from './checkout-orders.service';

/**
 * Every write is conditional on the current status, so two API instances
 * running the same tick cannot confirm or expire an order twice.
 */
@Injectable()
export class CheckoutWorker {
  private readonly logger = new Logger(CheckoutWorker.name);
  constructor(private readonly orders: CheckoutOrdersService) {}

  @Cron(CronExpression.EVERY_MINUTE, { waitForCompletion: true })
  async tick(): Promise<void> {
    await this.step('uncertain', () => this.orders.reconcileUncertain());
    await this.step('expire', () => this.orders.expireOverdue());
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
