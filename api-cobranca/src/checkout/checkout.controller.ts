import {
  Body,
  Controller,
  Delete,
  Get,
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
import { CheckoutProductsService } from './checkout-products.service';
import { CheckoutSettingsService } from './checkout-settings.service';
import {
  CheckoutBumpDto,
  CheckoutProductDto,
  ListCheckoutProductsQueryDto,
  ReorderCheckoutBumpsDto,
  SetCheckoutActiveDto,
  UpdateCheckoutBumpDto,
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

@Controller('checkout')
@UseGuards(JwtAuthGuard)
@CompanyProducts('CHECKOUT')
export class CheckoutController {
  constructor(
    private readonly settings: CheckoutSettingsService,
    private readonly assets: CheckoutAssetsService,
    private readonly products: CheckoutProductsService,
    private readonly coupons: CheckoutCouponsService,
  ) {}

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
