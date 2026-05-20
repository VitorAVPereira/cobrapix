import { Module } from '@nestjs/common';
import { PaymentModule } from '../payment/payment.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PlatformAdminGuard } from './guards/platform-admin.guard';

@Module({
  imports: [PaymentModule, WhatsappModule],
  controllers: [AdminController],
  providers: [AdminService, PlatformAdminGuard],
})
export class AdminModule {}
