import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { FinancialEligibilityService } from '../financial-activation/financial-eligibility.service';
import { DisbursementSettingsService } from './disbursement-settings.service';
import { DisbursementRecipientsService } from './disbursement-recipients.service';
import { DisbursementsAdminController } from './disbursements-admin.controller';
import { DisbursementsController } from './disbursements.controller';

@Module({
  imports: [PrismaModule],
  controllers: [DisbursementsAdminController, DisbursementsController],
  providers: [
    DisbursementSettingsService,
    DisbursementRecipientsService,
    FinancialEligibilityService,
    PlatformAdminGuard,
  ],
})
export class DisbursementsModule {}
