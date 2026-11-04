import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CERTIFICATE_MAX_BYTES } from '../financial-activation/financial-activation.service';
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

// Without `dest`/`storage`, multer keeps the certificate in memory only.
const certificateUpload = FileInterceptor('certificate', {
  limits: {
    fileSize: CERTIFICATE_MAX_BYTES,
    files: 1,
    fields: 12,
    fieldSize: 1024,
    parts: 13,
  },
});

@Controller('admin/checkout/platform-account')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class CheckoutPlatformController {
  constructor(private readonly platform: CheckoutPlatformService) {}

  @Get() view() {
    return this.platform.view();
  }

  @Post('credentials')
  @UseInterceptors(certificateUpload)
  upload(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: UploadPlatformCredentialsDto,
    @UploadedFile() file: UploadedCertificate | undefined,
  ) {
    return this.platform.uploadCredentials(
      user.userId,
      user.companyId,
      dto,
      file,
    );
  }

  @Post('validate') validate(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: ValidatePlatformAccountDto,
  ) {
    return this.platform.validate(user.userId, user.companyId, dto);
  }

  @Put('card') setCard(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: SetPlatformCardDto,
  ) {
    return this.platform.setCard(user.userId, user.companyId, dto);
  }

  @Put('pix-fee') setPixFee(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: SetPlatformPixFeeDto,
  ) {
    return this.platform.setPixFee(user.userId, user.companyId, dto);
  }
}
