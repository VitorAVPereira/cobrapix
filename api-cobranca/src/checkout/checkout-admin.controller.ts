import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CheckoutAdminService } from './checkout-admin.service';
import {
  CreateCheckoutClientDto,
  UpdateCheckoutTermsDto,
} from './dto/checkout-admin.dto';

@Controller('admin/checkout/clients')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class CheckoutAdminController {
  constructor(private readonly admin: CheckoutAdminService) {}

  @Get() list() {
    return this.admin.list();
  }

  @Post() create(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: CreateCheckoutClientDto,
  ) {
    return this.admin.create(dto, user.userId);
  }

  @Get(':companyId') detail(
    @Param('companyId', ParseUUIDPipe) companyId: string,
  ) {
    return this.admin.detail(companyId);
  }

  @Put(':companyId/terms') updateTerms(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @GetUser() user: AuthenticatedUser,
    @Body() dto: UpdateCheckoutTermsDto,
  ) {
    return this.admin.updateTerms(companyId, dto, user.userId);
  }
}
