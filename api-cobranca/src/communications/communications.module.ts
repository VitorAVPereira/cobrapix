import { Module } from '@nestjs/common';
import { PaymentModule } from '../payment/payment.module';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { CommunicationsController } from './communications.controller';
import { CommunicationsService } from './communications.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ResendMailerService } from '../common/resend-mailer.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [PaymentModule, WhatsappModule, ConfigModule],
  controllers: [CommunicationsController],
  providers: [CommunicationsService, PlatformAdminGuard, ResendMailerService],
  exports: [CommunicationsService],
})
export class CommunicationsModule {}
