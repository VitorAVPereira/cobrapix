import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentModule } from '../payment/payment.module';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsAppConversationService } from './conversation.service';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { WhatsappTransportModule } from './transport/whatsapp-transport.module';
import { OutboundIntentModule } from '../communications/outbound-intent.module';
import { OutboundDispatcherService } from './outbound-dispatcher.service';

@Module({
  imports: [
    ConfigModule,
    OutboundIntentModule,
    WhatsappTransportModule,
    PrismaModule,
    PaymentModule,
    forwardRef(() => QueueModule),
  ],
  controllers: [WhatsappController],
  providers: [
    WhatsappService,
    OutboundDispatcherService,
    WhatsAppConversationService,
    PlatformAdminGuard,
  ],
  exports: [WhatsappService, WhatsAppConversationService],
})
export class WhatsappModule {}
