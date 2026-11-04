import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { CheckoutAdminController } from './checkout-admin.controller';
import { CheckoutAdminService } from './checkout-admin.service';
import { CheckoutAssetsService } from './checkout-assets.service';
import { CheckoutController } from './checkout.controller';
import { CheckoutPublicController } from './checkout-public.controller';
import { CheckoutProductsService } from './checkout-products.service';
import { CheckoutCouponsService } from './checkout-coupons.service';
import { CheckoutSettingsService } from './checkout-settings.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    CheckoutAdminController,
    CheckoutController,
    CheckoutPublicController,
  ],
  providers: [
    CheckoutAdminService,
    CheckoutAssetsService,
    CheckoutSettingsService,
    CheckoutProductsService,
    CheckoutCouponsService,
    PlatformAdminGuard,
  ],
})
export class CheckoutModule {}
