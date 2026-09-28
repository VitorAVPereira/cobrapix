import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentModule } from '../payment/payment.module';
import { OutboundIntentService } from './outbound-intent.service';
import { CommunicationAttributionService } from './communication-attribution.service';
import { OutboundIntentController } from './outbound-intent.controller';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { CommunicationTokenService } from './communication-token.service';
import { TemplatePolicyModule } from '../templates/template-policy.module';
import { TemplatePendingService } from './template-pending.service';

@Module({
  imports: [PrismaModule, PaymentModule, TemplatePolicyModule],
  controllers: [OutboundIntentController],
  providers: [
    OutboundIntentService,
    CommunicationAttributionService,
    CommunicationTokenService,
    TemplatePendingService,
    PlatformAdminGuard,
  ],
  exports: [
    OutboundIntentService,
    CommunicationAttributionService,
    CommunicationTokenService,
    TemplatePendingService,
    TemplatePolicyModule,
  ],
})
export class OutboundIntentModule {}
