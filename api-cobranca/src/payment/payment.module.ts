import { CardReconciliationWorker } from './card-reconciliation.worker';
import { CardPaymentService } from './card-payment.service';
import { EfiCardClient } from './efi-card.client';
import {
  CardPublicPaymentController,
  CardAdminPaymentController,
} from './card-payment.controller';
import { CardCheckoutGuard } from './card-checkout.guard';
import { ThrottleGuard } from '../common/guards/throttle.guard';
import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { PaymentAdminController } from './payment-admin.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EfiService } from './efi.service';
import { PaymentCryptoService } from './payment-crypto.service';
import { PaymentNotificationsController } from './payment-notifications.controller';
import { PaymentNotificationsService } from './payment-notifications.service';
import { PublicPaymentController } from './public-payment.controller';
import { PublicPaymentLinkService } from './payment-link.service';
import { ResendMailerService } from '../common/resend-mailer.service';
import { EfiGatewayClient } from './efi-gateway.client';
import { GatewayHealthService } from './gateway-health.service';
import { FinancialEligibilityService } from '../financial-activation/financial-eligibility.service';
import {
  PaymentFeeController,
  AdminPaymentFeeController,
} from '../payment-fees/payment-fee.controller';
import { PaymentFeeService } from '../payment-fees/payment-fee.service';
import { PaymentChargeService } from './payment-charge.service';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';

@Module({
  imports: [PrismaModule],
  controllers: [
    CardPublicPaymentController,
    CardAdminPaymentController,
    PaymentFeeController,
    AdminPaymentFeeController,
    PaymentController,
    PaymentAdminController,
    PaymentNotificationsController,
    PublicPaymentController,
  ],
  providers: [
    CardReconciliationWorker,
    CardPaymentService,
    EfiCardClient,
    CardCheckoutGuard,
    ThrottleGuard,
    PaymentFeeService,
    PaymentChargeService,
    PlatformAdminGuard,
    PaymentService,
    EfiService,
    PaymentCryptoService,
    PaymentNotificationsService,
    PublicPaymentLinkService,
    ResendMailerService,
    EfiGatewayClient,
    GatewayHealthService,
    FinancialEligibilityService,
  ],
  exports: [
    CardPaymentService,
    PaymentFeeService,
    PaymentChargeService,
    PaymentService,
    EfiService,
    PaymentCryptoService,
    PaymentNotificationsService,
    PublicPaymentLinkService,
    EfiGatewayClient,
    GatewayHealthService,
    FinancialEligibilityService,
  ],
})
export class PaymentModule {}
