import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EfiService } from './efi.service';
import { PaymentCryptoService } from './payment-crypto.service';

@Module({
  imports: [PrismaModule],
  controllers: [PaymentController],
  providers: [PaymentService, EfiService, PaymentCryptoService],
  exports: [PaymentService, EfiService, PaymentCryptoService],
})
export class PaymentModule {}
