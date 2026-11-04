import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ThrottleGuard } from '../common/guards/throttle.guard';
import { CheckoutAssetsService } from './checkout-assets.service';
import { CheckoutCatalogService } from './checkout-catalog.service';
import { CheckoutOrdersService } from './checkout-orders.service';
import { CheckoutRefundsService } from './checkout-refunds.service';
import { RefundRequestDto } from './dto/checkout-finance.dto';
import { CheckoutRecoveryService } from './checkout-recovery.service';
import { CheckoutCardService } from './checkout-card.service';
import { CheckoutOffersService } from './checkout-offers.service';
import {
  CheckoutOfferAcceptDto,
  CheckoutOfferChoiceDto,
  CheckoutOfferQueryDto,
} from './dto/checkout-offer.dto';
import {
  CheckoutCardOrderDto,
  CheckoutCardPayDto,
  CheckoutCardQuoteDto,
} from './dto/checkout-card.dto';
import {
  CheckoutLeadDto,
  CheckoutQuoteDto,
  CreateCheckoutOrderDto,
} from './dto/checkout-public.dto';

// Malformed addresses never reach the database.
function slugOf(value: string): string {
  if (!/^[a-z0-9-]{1,64}$/.test(value))
    throw new NotFoundException('Produto não encontrado.');
  return value;
}
function tokenOf(value: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value))
    throw new NotFoundException('Pedido não encontrado.');
  return value;
}
function offerTokenOf(value: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value))
    throw new NotFoundException('Oferta não encontrada.');
  return value;
}

@Controller('checkout/public')
@UseGuards(ThrottleGuard)
export class CheckoutPublicController {
  constructor(
    private readonly assets: CheckoutAssetsService,
    private readonly catalog: CheckoutCatalogService,
    private readonly orders: CheckoutOrdersService,
    private readonly refunds: CheckoutRefundsService,
    private readonly recovery: CheckoutRecoveryService,
    private readonly card: CheckoutCardService,
    private readonly offers: CheckoutOffersService,
  ) {}

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

  @Get('products/:slug') product(@Param('slug') slug: string) {
    return this.catalog.view(slugOf(slug));
  }

  @Post('products/:slug/quote')
  @HttpCode(200)
  quote(@Param('slug') slug: string, @Body() dto: CheckoutQuoteDto) {
    return this.catalog.quote(slugOf(slug), dto);
  }

  @Post('products/:slug/lead')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  lead(@Param('slug') slug: string, @Body() dto: CheckoutLeadDto) {
    return this.recovery.captureLead(slugOf(slug), {
      ...dto,
      utm: dto.utm as Record<string, string> | undefined,
    });
  }

  @Post('products/:slug/orders')
  @Header('Cache-Control', 'no-store')
  order(@Param('slug') slug: string, @Body() dto: CreateCheckoutOrderDto) {
    return this.orders.create(slugOf(slug), dto);
  }

  @Post('products/:slug/card/quote')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  cardQuote(@Param('slug') slug: string, @Body() dto: CheckoutCardQuoteDto) {
    return this.card.quote(slugOf(slug), dto);
  }

  @Post('products/:slug/card/orders')
  @Header('Cache-Control', 'no-store')
  cardOrder(@Param('slug') slug: string, @Body() dto: CheckoutCardOrderDto) {
    return this.card.createOrder(slugOf(slug), dto);
  }

  @Post('orders/:token/card/pay')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  cardPay(@Param('token') token: string, @Body() dto: CheckoutCardPayDto) {
    return this.card.pay(tokenOf(token), dto);
  }

  @Get('offers/:token')
  @Header('Cache-Control', 'no-store')
  offer(@Param('token') token: string, @Query() query: CheckoutOfferQueryDto) {
    return this.offers.view(offerTokenOf(token), query.oferta);
  }

  @Post('offers/:token/card/quote')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  offerCardQuote(
    @Param('token') token: string,
    @Body() dto: CheckoutOfferChoiceDto,
  ) {
    return this.offers.cardQuote(offerTokenOf(token), dto);
  }

  @Post('offers/:token/accept')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  acceptOffer(
    @Param('token') token: string,
    @Body() dto: CheckoutOfferAcceptDto,
  ) {
    return this.offers.accept(offerTokenOf(token), dto);
  }

  @Post('offers/:token/decline')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  declineOffer(
    @Param('token') token: string,
    @Body() dto: CheckoutOfferChoiceDto,
  ) {
    return this.offers.decline(offerTokenOf(token), dto);
  }

  @Get('orders/:token')
  @Header('Cache-Control', 'no-store')
  orderStatus(@Param('token') token: string) {
    return this.orders.view(tokenOf(token));
  }

  @Post('orders/:token/refund-request')
  @Header('Cache-Control', 'no-store')
  requestRefund(@Param('token') token: string, @Body() dto: RefundRequestDto) {
    return this.refunds.requestByBuyer(tokenOf(token), dto.reason);
  }
}
