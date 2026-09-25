import { Module } from '@nestjs/common';
import { PaymentModule } from '../payment/payment.module';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PlatformAdminGuard } from './guards/platform-admin.guard';

@Module({
  imports: [PaymentModule],
  controllers: [AdminController],
  providers: [AdminService, AdminAnalyticsService, PlatformAdminGuard],
})
export class AdminModule {}
