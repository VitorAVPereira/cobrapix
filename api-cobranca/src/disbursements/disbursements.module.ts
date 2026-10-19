import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentModule } from '../payment/payment.module';
import { TemplatePolicyModule } from '../templates/template-policy.module';
import { TemplateSendModule } from '../templates/template-send.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { FinancialEligibilityService } from '../financial-activation/financial-eligibility.service';
import { DisbursementSettingsService } from './disbursement-settings.service';
import { DisbursementRecipientsService } from './disbursement-recipients.service';
import { DisbursementBatchesService } from './disbursement-batches.service';
import { DisbursementApprovalService } from './disbursement-approval.service';
import { DisbursementSenderService } from './disbursement-sender.service';
import { EfiDisbursementClient } from './efi-disbursement.client';
import { DisbursementWorker } from './disbursement.worker';
import { DisbursementSchedulerService } from './disbursement-scheduler.service';
import { DisbursementsAdminController } from './disbursements-admin.controller';
import { DisbursementsController } from './disbursements.controller';

@Module({
  imports: [
    PrismaModule,
    PaymentModule,
    TemplatePolicyModule,
    TemplateSendModule,
    WhatsappModule,
  ],
  controllers: [DisbursementsAdminController, DisbursementsController],
  providers: [
    DisbursementSettingsService,
    DisbursementRecipientsService,
    DisbursementBatchesService,
    DisbursementApprovalService,
    DisbursementSenderService,
    EfiDisbursementClient,
    DisbursementWorker,
    DisbursementSchedulerService,
    FinancialEligibilityService,
    PlatformAdminGuard,
  ],
})
export class DisbursementsModule {}
