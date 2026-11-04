import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompanyProducts } from '../auth/decorators/company-products.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  CHECKOUT_ASSET_MAX_BYTES,
  CheckoutAssetsService,
  type UploadedImageFile,
} from './checkout-assets.service';
import { CheckoutCouponsService } from './checkout-coupons.service';
import { CheckoutLedgerService } from './checkout-ledger.service';
import { CheckoutRefundsService } from './checkout-refunds.service';
import {
  PageQueryDto,
  RecoveryQueryDto,
  RefundRequestDto,
  SalesQueryDto,
  WebhookUrlDto,
} from './dto/checkout-finance.dto';
import { CheckoutWebhooksService } from './checkout-webhooks.service';
import {
  CheckoutRecoveryService,
  RECOVERY_WINDOW_MS,
} from './checkout-recovery.service';
import { CheckoutProductsService } from './checkout-products.service';
import { CheckoutSettingsService } from './checkout-settings.service';
import {
  CheckoutBumpDto,
  CheckoutOfferDto,
  CheckoutProductDto,
  ListCheckoutProductsQueryDto,
  ReorderCheckoutBumpsDto,
  SetCheckoutActiveDto,
  UpdateCheckoutBumpDto,
  UpdateCheckoutOfferDto,
  UpdateCheckoutProductDto,
} from './dto/checkout-product.dto';
import {
  CheckoutCouponDto,
  UpdateCheckoutCouponDto,
} from './dto/checkout-coupon.dto';
import {
  UpdateCheckoutSettingsDto,
  UploadCheckoutAssetDto,
} from './dto/checkout-settings.dto';

// Multer keeps the image in memory; nothing touches the filesystem.
const imageUpload = FileInterceptor('file', {
  limits: {
    fileSize: CHECKOUT_ASSET_MAX_BYTES,
    files: 1,
    fields: 2,
    fieldSize: 64,
    parts: 3,
  },
});

function recoveryFilters(query: RecoveryQueryDto) {
  const from = query.from
    ? new Date(query.from)
    : query.to
      ? undefined
      : new Date(Date.now() - RECOVERY_WINDOW_MS);
  return {
    kind: query.kind,
    productId: query.productId,
    from,
    to: query.to ? new Date(query.to) : undefined,
    state: query.state ?? ('OPEN' as const),
  };
}

@Controller('checkout')
@UseGuards(JwtAuthGuard)
@CompanyProducts('CHECKOUT')
export class CheckoutController {
  constructor(
    private readonly settings: CheckoutSettingsService,
    private readonly assets: CheckoutAssetsService,
    private readonly products: CheckoutProductsService,
    private readonly coupons: CheckoutCouponsService,
    private readonly ledger: CheckoutLedgerService,
    private readonly refunds: CheckoutRefundsService,
    private readonly webhooks: CheckoutWebhooksService,
    private readonly recovery: CheckoutRecoveryService,
  ) {}

  @Get('webhook') webhook(@GetUser() user: AuthenticatedUser) {
    return this.webhooks.view(user.companyId);
  }

  @Put('webhook') setWebhook(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: WebhookUrlDto,
  ) {
    return this.webhooks.setUrl(user.companyId, dto.url ?? null);
  }

  @Post('webhook/secret') rotateWebhookSecret(
    @GetUser() user: AuthenticatedUser,
  ) {
    return this.webhooks.rotateSecret(user.companyId);
  }

  @Post('webhook/enable') enableWebhook(@GetUser() user: AuthenticatedUser) {
    return this.webhooks.enable(user.companyId);
  }

  @Post('webhook/test') testWebhook(@GetUser() user: AuthenticatedUser) {
    return this.webhooks.test(user.companyId);
  }

  @Get('webhook/deliveries') webhookDeliveries(
    @GetUser() user: AuthenticatedUser,
    @Query() query: PageQueryDto,
  ) {
    return this.webhooks.deliveries(
      user.companyId,
      query.page ?? 1,
      query.pageSize ?? 20,
    );
  }

  @Post('webhook/deliveries/:id/resend')
  @HttpCode(204)
  async resendWebhook(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.webhooks.resend(user.companyId, id);
  }

  @Get('balance') balance(@GetUser() user: AuthenticatedUser) {
    return this.ledger.balance(user.companyId);
  }

  @Get('sales') sales(
    @GetUser() user: AuthenticatedUser,
    @Query() query: SalesQueryDto,
  ) {
    return this.ledger.sales(user.companyId, {
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      status: query.status,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    });
  }

  // Default view: who is still to recover, last 30 days.
  @Get('recovery') recoveryList(
    @GetUser() user: AuthenticatedUser,
    @Query() query: RecoveryQueryDto,
  ) {
    return this.recovery.list(user.companyId, {
      ...recoveryFilters(query),
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    });
  }

  @Get('recovery.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="recuperacao.csv"')
  @Header('Cache-Control', 'no-store')
  recoveryCsv(
    @GetUser() user: AuthenticatedUser,
    @Query() query: RecoveryQueryDto,
  ) {
    return this.recovery.csv(
      user.companyId,
      user.userId,
      recoveryFilters(query),
    );
  }

  @Post('sales/:orderId/refund-request') requestRefund(
    @GetUser() user: AuthenticatedUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: RefundRequestDto,
  ) {
    return this.refunds.requestBySeller(user.companyId, orderId, dto.reason);
  }

  @Get('settings') getSettings(@GetUser() user: AuthenticatedUser) {
    return this.settings.get(user.companyId);
  }

  @Put('settings') updateSettings(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: UpdateCheckoutSettingsDto,
  ) {
    return this.settings.update(user.companyId, dto);
  }

  @Post('assets')
  @UseInterceptors(imageUpload)
  uploadAsset(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: UploadCheckoutAssetDto,
    @UploadedFile() file: UploadedImageFile | undefined,
  ) {
    return this.assets.upload(user.companyId, dto.kind, file);
  }

  @Get('products') listProducts(
    @GetUser() user: AuthenticatedUser,
    @Query() query: ListCheckoutProductsQueryDto,
  ) {
    const active =
      query.active === undefined ? undefined : query.active === 'true';
    return this.products.list(user.companyId, active);
  }

  @Post('products') createProduct(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: CheckoutProductDto,
  ) {
    return this.products.create(user.companyId, dto);
  }

  @Get('products/:id') getProduct(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.products.detail(user.companyId, id);
  }

  @Put('products/:id') updateProduct(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCheckoutProductDto,
  ) {
    return this.products.update(user.companyId, id, dto);
  }

  @Patch('products/:id/active') setProductActive(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCheckoutActiveDto,
  ) {
    return this.products.setActive(user.companyId, id, dto);
  }

  @Post('products/:id/bumps') createBump(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CheckoutBumpDto,
  ) {
    return this.products.createBump(user.companyId, id, dto);
  }

  @Put('products/:id/bumps/order') reorderBumps(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderCheckoutBumpsDto,
  ) {
    return this.products.reorderBumps(user.companyId, id, dto);
  }

  @Put('products/:id/bumps/:bumpId') updateBump(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('bumpId', ParseUUIDPipe) bumpId: string,
    @Body() dto: UpdateCheckoutBumpDto,
  ) {
    return this.products.updateBump(user.companyId, id, bumpId, dto);
  }

  @Delete('products/:id/bumps/:bumpId') removeBump(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('bumpId', ParseUUIDPipe) bumpId: string,
  ) {
    return this.products.removeBump(user.companyId, id, bumpId);
  }

  @Post('products/:id/offers') createOffer(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CheckoutOfferDto,
  ) {
    return this.products.createOffer(user.companyId, id, dto);
  }

  @Put('products/:id/offers/:offerId') updateOffer(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() dto: UpdateCheckoutOfferDto,
  ) {
    return this.products.updateOffer(user.companyId, id, offerId, dto);
  }

  @Get('coupons') listCoupons(@GetUser() user: AuthenticatedUser) {
    return this.coupons.list(user.companyId);
  }

  @Post('coupons') createCoupon(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: CheckoutCouponDto,
  ) {
    return this.coupons.create(user.companyId, dto);
  }

  @Put('coupons/:id') updateCoupon(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCheckoutCouponDto,
  ) {
    return this.coupons.update(user.companyId, id, dto);
  }

  @Patch('coupons/:id/active') setCouponActive(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCheckoutActiveDto,
  ) {
    return this.coupons.setActive(user.companyId, id, dto);
  }
}
