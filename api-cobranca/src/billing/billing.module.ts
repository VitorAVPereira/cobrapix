import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { CollectionProfileService } from './collection-profile.service';
import { CollectionRuleEngine } from './collection-rule-engine';
import { QueueModule } from '../queue/queue.module';
import { PaymentModule } from '../payment/payment.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { EmailModule } from '../email/email.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TemplateSendModule } from '../templates/template-send.module';
import { TemplatePolicyModule } from '../templates/template-policy.module';

@Module({
  imports: [
    PrismaModule,
    QueueModule,
    PaymentModule,
    WhatsappModule,
    EmailModule,
    TemplateSendModule,
    TemplatePolicyModule,
  ],
  controllers: [BillingController],
  providers: [BillingService, CollectionProfileService, CollectionRuleEngine],
  exports: [BillingService, CollectionProfileService, CollectionRuleEngine],
})
export class BillingModule {}
