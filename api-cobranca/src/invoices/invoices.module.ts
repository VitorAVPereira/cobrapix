import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { QueueModule } from '../queue/queue.module';
import { PaymentModule } from '../payment/payment.module';

@Module({
  imports: [QueueModule, PaymentModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
