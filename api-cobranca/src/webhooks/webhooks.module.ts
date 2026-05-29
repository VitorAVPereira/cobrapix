import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { PaymentModule } from '../payment/payment.module';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { EfiWebhookGuard } from './efi-webhook.guard';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [
    PrismaModule,
    PaymentModule,
    QueueModule,
    WhatsappModule,
    EmailModule,
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService, EfiWebhookGuard],
})
export class WebhooksModule {}
