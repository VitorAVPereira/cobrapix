import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { QueueModule } from '../queue/queue.module';
import { PaymentModule } from '../payment/payment.module';

@Module({
  imports: [QueueModule, PaymentModule],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
