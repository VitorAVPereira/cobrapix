import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { certificateUpload } from './checkout-platform.controller';
import {
  CheckoutPlatformService,
  type UploadedCertificate,
} from './checkout-platform.service';
import {
  SetPlatformCardDto,
  SetPlatformPixFeeDto,
  UploadPlatformCredentialsDto,
  ValidatePlatformAccountDto,
} from './dto/checkout-platform.dto';

/**
 * The Efí account of a seller that sells through its own account, managed by
 * the admin. Same steps as the CifraMais account; the audit goes to the seller.
 */
@Controller('admin/checkout/clients/:companyId/account')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class CheckoutSellerAccountController {
  constructor(private readonly platform: CheckoutPlatformService) {}

  @Get() view(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.platform.view(companyId);
  }

  @Post('credentials')
  @UseInterceptors(certificateUpload)
  upload(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @GetUser() user: AuthenticatedUser,
    @Body() dto: UploadPlatformCredentialsDto,
    @UploadedFile() file: UploadedCertificate | undefined,
  ) {
    return this.platform.uploadCredentials(
      user.userId,
      companyId,
      dto,
      file,
      companyId,
    );
  }

  @Post('validate') validate(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @GetUser() user: AuthenticatedUser,
    @Body() dto: ValidatePlatformAccountDto,
  ) {
    return this.platform.validate(user.userId, companyId, dto, companyId);
  }

  @Put('card') setCard(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @GetUser() user: AuthenticatedUser,
    @Body() dto: SetPlatformCardDto,
  ) {
    return this.platform.setCard(user.userId, companyId, dto, companyId);
  }

  @Put('pix-fee') setPixFee(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @GetUser() user: AuthenticatedUser,
    @Body() dto: SetPlatformPixFeeDto,
  ) {
    return this.platform.setPixFee(user.userId, companyId, dto, companyId);
  }
}
