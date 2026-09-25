import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentModule } from '../payment/payment.module';
import { CompanyFinancialProfileController } from './company-financial-profile.controller';
import { CompanyFinancialProfileService } from './company-financial-profile.service';
import { ResendMailerService } from '../common/resend-mailer.service';
import { EfiAccountRegistryService } from './efi-account-registry.service';
import { FinancialCertificateMonitor } from './financial-certificate-monitor';
import { FinancialActivationController } from './financial-activation.controller';
import { FinancialActivationService } from './financial-activation.service';
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
  controllers: [
    FinancialActivationController,
    CompanyFinancialProfileController,
  ],
  providers: [
    FinancialActivationService,
    EfiAccountRegistryService,
    FinancialValidationService,
    FinancialValidationJobs,
    FinancialValidationWorker,
    CompanyFinancialProfileService,
    FinancialCertificateMonitor,
    ResendMailerService,
  ],
  exports: [FinancialActivationService, EfiAccountRegistryService],
})
export class FinancialActivationModule {}
