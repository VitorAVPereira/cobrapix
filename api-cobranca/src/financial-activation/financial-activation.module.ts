import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentModule } from '../payment/payment.module';
import { EfiAccountRegistryService } from './efi-account-registry.service';
import { FinancialActivationController } from './financial-activation.controller';
import { FinancialActivationService } from './financial-activation.service';
import { FinancialEligibilityService } from './financial-eligibility.service';
import {
  FINANCIAL_VALIDATION_QUEUE,
  FinancialValidationJobs,
} from './financial-validation.jobs';
import { FinancialValidationService } from './financial-validation.service';
import { FinancialValidationWorker } from './financial-validation.worker';

@Module({
  imports: [
    PrismaModule,
    PaymentModule,
    BullModule.registerQueue({ name: FINANCIAL_VALIDATION_QUEUE }),
  ],
  controllers: [FinancialActivationController],
  providers: [
    FinancialActivationService,
    EfiAccountRegistryService,
    FinancialValidationService,
    FinancialValidationJobs,
    FinancialValidationWorker,
    FinancialEligibilityService,
  ],
  exports: [
    FinancialActivationService,
    EfiAccountRegistryService,
    FinancialEligibilityService,
  ],
})
export class FinancialActivationModule {}
