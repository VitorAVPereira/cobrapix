import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentModule } from '../payment/payment.module';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsAppConversationService } from './conversation.service';

@Module({
  imports: [ConfigModule, PrismaModule, PaymentModule, forwardRef(() => QueueModule)],
  controllers: [WhatsappController],
  providers: [WhatsappService, WhatsAppConversationService],
  exports: [WhatsappService, WhatsAppConversationService],
})
export class WhatsappModule {}
