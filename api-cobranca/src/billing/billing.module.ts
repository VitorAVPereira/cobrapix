import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    WhatsappModule,
  ],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
