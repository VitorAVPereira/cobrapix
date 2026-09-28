import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentModule } from '../payment/payment.module';
import { OutboundIntentModule } from '../communications/outbound-intent.module';
import { TemplateRenderingModule } from './template-rendering.module';
import { TemplateSendPreparerService } from './template-send-preparer.service';

/**
 * Preparation of template sends for every producer (collection, rule steps, activation
 * notices, inbox). Depends only on persistence and policy, never on queue or transport
 * modules, so producers import it without injection cycles.
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    PaymentModule,
    OutboundIntentModule,
    TemplateRenderingModule,
  ],
  providers: [TemplateSendPreparerService],
  exports: [TemplateSendPreparerService],
})
export class TemplateSendModule {}
