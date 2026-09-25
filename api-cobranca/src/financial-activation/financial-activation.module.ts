import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentModule } from '../payment/payment.module';
import { EfiAccountRegistryService } from './efi-account-registry.service';
import { FinancialActivationController } from './financial-activation.controller';
import { FinancialActivationService } from './financial-activation.service';

@Module({
  imports: [PrismaModule, PaymentModule],
  controllers: [FinancialActivationController],
  providers: [FinancialActivationService, EfiAccountRegistryService],
  exports: [FinancialActivationService, EfiAccountRegistryService],
})
export class FinancialActivationModule {}
