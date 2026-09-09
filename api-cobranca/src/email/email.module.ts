import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentModule } from '../payment/payment.module';
import { ResendMailerService } from '../common/resend-mailer.service';
import { EmailService } from './email.service';
import { EmailProcessor } from './email.processor';
import { EmailQueueService } from './email.queue';
import { EmailController } from './email.controller';
import { EmailTemplatesController } from './email-templates.controller';
import { EmailTemplatesService } from './email-templates.service';

@Module({
  imports: [
    PrismaModule,
    PaymentModule,
    BullModule.registerQueue({
      name: 'email-messages',
      defaultJobOptions: {
        removeOnComplete: { count: 5000, age: 48 * 3600 },
        removeOnFail: { count: 10000, age: 14 * 24 * 3600 },
      },
    }),
  ],
  controllers: [EmailController, EmailTemplatesController],
  providers: [
    EmailService,
    EmailTemplatesService,
    EmailProcessor,
    EmailQueueService,
    ResendMailerService,
  ],
  exports: [EmailService, EmailTemplatesService, EmailQueueService],
})
export class EmailModule {}
