import { Controller, Get, Param } from '@nestjs/common';
import {
  PublicPaymentLinkService,
  PublicPaymentResponse,
} from './payment-link.service';

@Controller('payments/public')
export class PublicPaymentController {
  constructor(private readonly paymentLinks: PublicPaymentLinkService) {}

  @Get(':token')
  async getPayment(
    @Param('token') token: string,
  ): Promise<PublicPaymentResponse> {
    return this.paymentLinks.getPublicPayment(token);
  }
}
