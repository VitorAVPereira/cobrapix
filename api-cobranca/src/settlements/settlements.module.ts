import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { SettlementsController } from './settlements.controller';
import { CompanyFinancialController } from './company-financial.controller';
import { SettlementsService } from './settlements.service';

// Phase A: reconciliation of payments received directly by the customer's
// own Efí account. Manual payout batches belong to Phase B.
@Module({
  imports: [PrismaModule],
  controllers: [SettlementsController, CompanyFinancialController],
  providers: [SettlementsService, PlatformAdminGuard],
  exports: [SettlementsService],
})
export class SettlementsModule {}
