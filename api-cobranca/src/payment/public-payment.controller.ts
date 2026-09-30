import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  PublicPaymentLinkService,
  PublicPaymentResponse,
} from './payment-link.service';

// Anonymous access by signed link only: the token is the sole input (no query
// field can replace the signed ids) and it grants no session.
@Controller('payments/public')
export class PublicPaymentController {
  constructor(private readonly paymentLinks: PublicPaymentLinkService) {}

  @Get(':token')
  async getPayment(
    @Param('token') token: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicPaymentResponse> {
    // Set before the lookup so errors are not cached either: a closed charge
    // must never be served from a stale copy that still has instruments.
    response.setHeader('Cache-Control', 'no-store');
    return this.paymentLinks.getPublicPayment(token);
  }
}
