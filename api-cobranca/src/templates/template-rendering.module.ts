import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentModule } from '../payment/payment.module';
import { TemplateContextService } from './template-context.service';

/** Context loading for template sends; independent of the HTTP catalog module. */
@Module({
  imports: [PrismaModule, PaymentModule],
  providers: [TemplateContextService],
  exports: [TemplateContextService],
})
export class TemplateRenderingModule {}
