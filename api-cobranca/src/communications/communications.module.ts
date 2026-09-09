import { Module } from '@nestjs/common';
import { PaymentModule } from '../payment/payment.module';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { CommunicationsController } from './communications.controller';
import { CommunicationsService } from './communications.service';

@Module({
  imports: [PaymentModule],
  controllers: [CommunicationsController],
  providers: [CommunicationsService, PlatformAdminGuard],
  exports: [CommunicationsService],
})
export class CommunicationsModule {}
