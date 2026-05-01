import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MessageQueueService } from './message.queue';
import { MessageWorkerService } from './workers/message.worker';
import { SpintaxService } from './services/spintax.service';
import { RateLimitService } from './services/rate-limit.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentModule } from '../payment/payment.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    PrismaModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST') || 'localhost',
          port: configService.get<number>('REDIS_PORT') || 6379,
          password: configService.get<string>('REDIS_PASSWORD'),
        },
      }),
    }),
    BullModule.registerQueue({
      name: 'whatsapp-messages',
      defaultJobOptions: {
        removeOnComplete: {
          count: 1000,
          age: 24 * 3600,
        },
        removeOnFail: {
          count: 5000,
          age: 7 * 24 * 3600,
        },
      },
    }),
    PaymentModule,
    WhatsappModule,
  ],
  providers: [
    MessageQueueService,
    MessageWorkerService,
    SpintaxService,
    RateLimitService,
  ],
  exports: [MessageQueueService, SpintaxService, RateLimitService],
})
export class QueueModule {}
