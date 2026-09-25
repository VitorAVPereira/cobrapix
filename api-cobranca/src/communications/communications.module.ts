import { Module } from '@nestjs/common';
import { PaymentModule } from '../payment/payment.module';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { CommunicationsController } from './communications.controller';
import { CommunicationsService } from './communications.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ResendMailerService } from '../common/resend-mailer.service';
import { ConfigModule } from '@nestjs/config';
import { OutboundIntentModule } from './outbound-intent.module';
import { CommunicationsTenantService } from './communications-tenant.service';
import { WhatsappTransportModule } from '../whatsapp/transport/whatsapp-transport.module';
import { CommunicationMediaService } from './communication-media.service';
import { CommunicationsMediaController } from './communications-media.controller';

@Module({
  imports: [
    PaymentModule,
    WhatsappModule,
    WhatsappTransportModule,
    ConfigModule,
    OutboundIntentModule,
  ],
  controllers: [CommunicationsController, CommunicationsMediaController],
  providers: [
    CommunicationsService,
    CommunicationsTenantService,
    CommunicationMediaService,
    PlatformAdminGuard,
    ResendMailerService,
  ],
  exports: [CommunicationsService, OutboundIntentModule],
})
export class CommunicationsModule {}
