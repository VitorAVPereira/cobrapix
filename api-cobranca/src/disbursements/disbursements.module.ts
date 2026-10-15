import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { FinancialEligibilityService } from '../financial-activation/financial-eligibility.service';
import { DisbursementSettingsService } from './disbursement-settings.service';
import { DisbursementsAdminController } from './disbursements-admin.controller';

@Module({
  imports: [PrismaModule],
  controllers: [DisbursementsAdminController],
  providers: [
    DisbursementSettingsService,
    FinancialEligibilityService,
    PlatformAdminGuard,
  ],
})
export class DisbursementsModule {}
