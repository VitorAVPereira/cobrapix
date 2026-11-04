import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CheckoutAssetsService } from './checkout-assets.service';

@Controller('checkout/public')
export class CheckoutPublicController {
  constructor(private readonly assets: CheckoutAssetsService) {}

  // An asset never changes once uploaded (a new image is a new id).
  @Get('assets/:id') async asset(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const asset = await this.assets.read(id);
    res
      .set({
        'Content-Type': asset.contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(asset.data);
  }
}
