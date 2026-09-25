import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { PaymentModule } from '../payment/payment.module';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { EfiWebhookGuard } from './efi-webhook.guard';
import { EfiMtlsGuard } from '../efi-onboarding/efi-mtls.guard';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { DatafyWebhookController } from './datafy-webhook.controller';
import { DatafyWebhookService } from './datafy-webhook.service';
import { DatafyWebhookWorker } from '../queue/workers/datafy-webhook.worker';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';

@Module({
  imports: [
    PrismaModule,
    PaymentModule,
    QueueModule,
    WhatsappModule,
    EmailModule,
  ],
  controllers: [WebhooksController, DatafyWebhookController],
  providers: [
    WebhooksService,
    EfiWebhookGuard,
    EfiMtlsGuard,
    DatafyWebhookService,
    DatafyWebhookWorker,
    PlatformAdminGuard,
  ],
})
export class WebhooksModule {}
