import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentModule } from '../payment/payment.module';
import { FinancialActivationModule } from '../financial-activation/financial-activation.module';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { ResendMailerService } from '../common/resend-mailer.service';
import { CheckoutAdminController } from './checkout-admin.controller';
import { CheckoutAdminService } from './checkout-admin.service';
import { CheckoutAssetsService } from './checkout-assets.service';
import { CheckoutController } from './checkout.controller';
import { CheckoutPublicController } from './checkout-public.controller';
import { CheckoutProductsService } from './checkout-products.service';
import { CheckoutCouponsService } from './checkout-coupons.service';
import { CheckoutSettingsService } from './checkout-settings.service';
import { CheckoutPlatformController } from './checkout-platform.controller';
import { CheckoutPlatformService } from './checkout-platform.service';
import { CheckoutCatalogService } from './checkout-catalog.service';
import { CheckoutOrdersService } from './checkout-orders.service';
import { CheckoutPaymentsService } from './checkout-payments.service';
import { EfiCheckoutPixClient } from './efi-checkout-pix.client';
import {
  CHECKOUT_MAIL_QUEUE,
  CheckoutMailJobs,
  CheckoutMailProcessor,
} from './checkout-mail.service';
import { CheckoutWorker } from './checkout.worker';

@Module({
  imports: [
    PrismaModule,
    PaymentModule,
    FinancialActivationModule,
    BullModule.registerQueue({ name: CHECKOUT_MAIL_QUEUE }),
  ],
  controllers: [
    CheckoutAdminController,
    CheckoutController,
    CheckoutPublicController,
    CheckoutPlatformController,
  ],
  providers: [
    CheckoutAdminService,
    CheckoutAssetsService,
    CheckoutSettingsService,
    CheckoutProductsService,
    CheckoutCouponsService,
    CheckoutPlatformService,
    CheckoutCatalogService,
    CheckoutOrdersService,
    CheckoutPaymentsService,
    EfiCheckoutPixClient,
    CheckoutMailJobs,
    CheckoutMailProcessor,
    CheckoutWorker,
    ResendMailerService,
    PlatformAdminGuard,
  ],
  // The Pix webhook (WebhooksModule) hands checkout events over.
  exports: [CheckoutPaymentsService],
})
export class CheckoutModule {}
