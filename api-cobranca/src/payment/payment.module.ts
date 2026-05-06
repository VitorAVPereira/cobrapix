import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EfiService } from './efi.service';
import { PaymentCryptoService } from './payment-crypto.service';
import { PaymentNotificationsController } from './payment-notifications.controller';
import { PaymentNotificationsService } from './payment-notifications.service';

@Module({
  imports: [PrismaModule],
  controllers: [PaymentController, PaymentNotificationsController],
  providers: [
    PaymentService,
    EfiService,
    PaymentCryptoService,
    PaymentNotificationsService,
  ],
  exports: [
    PaymentService,
    EfiService,
    PaymentCryptoService,
    PaymentNotificationsService,
  ],
})
export class PaymentModule {}
