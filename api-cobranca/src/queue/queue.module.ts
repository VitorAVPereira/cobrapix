import { forwardRef, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MessageQueueService } from './message.queue';
import { MessageWorkerService } from './workers/message.worker';
import { QueueController } from './queue.controller';
import { SpintaxService } from './services/spintax.service';
import { RateLimitService } from './services/rate-limit.service';
import { MessagingLimitService } from './services/messaging-limit.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentModule } from '../payment/payment.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { EmailModule } from '../email/email.module';
import { BullInfrastructureModule } from './bull-infrastructure.module';
import { WhatsappTransportModule } from '../whatsapp/transport/whatsapp-transport.module';
import { ConfigService } from '@nestjs/config';
import {
  DATAFY_WEBHOOK_QUEUE,
  DatafyWebhookQueue,
  datafyRedisConnection,
} from './datafy-webhook.queue';

@Module({
  imports: [
    PrismaModule,
    WhatsappTransportModule,
    BullInfrastructureModule,
    BullModule.registerQueueAsync({
      name: DATAFY_WEBHOOK_QUEUE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: datafyRedisConnection(config),
      }),
    }),
    BullModule.registerQueue({
      name: 'whatsapp-messages',
      defaultJobOptions: {
        removeOnComplete: {
          count: 5000,
          age: 48 * 3600,
        },
        removeOnFail: {
          count: 10000,
          age: 14 * 24 * 3600,
        },
      },
    }),
    PaymentModule,
    forwardRef(() => WhatsappModule),
    EmailModule,
  ],
  controllers: [QueueController],
  providers: [
    DatafyWebhookQueue,
    MessageQueueService,
    MessageWorkerService,
    SpintaxService,
    RateLimitService,
    MessagingLimitService,
  ],
  exports: [
    DatafyWebhookQueue,
    MessageQueueService,
    SpintaxService,
    RateLimitService,
    MessagingLimitService,
  ],
})
export class QueueModule {}
