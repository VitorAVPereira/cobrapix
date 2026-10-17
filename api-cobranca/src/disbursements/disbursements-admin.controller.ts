import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { DisbursementSettingsService } from './disbursement-settings.service';
import { DisbursementSenderService } from './disbursement-sender.service';
import { DisbursementSettingsDto } from './dto/disbursement-settings.dto';

@Controller('admin/disbursements')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class DisbursementsAdminController {
  constructor(
    private readonly settings: DisbursementSettingsService,
    private readonly sender: DisbursementSenderService,
  ) {}

  @Get(':companyId/settings') view(
    @Param('companyId', ParseUUIDPipe) companyId: string,
  ) {
    return this.settings.view(companyId);
  }

  @Post(':companyId/settings') configure(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @GetUser() user: AuthenticatedUser,
    @Body() dto: DisbursementSettingsDto,
  ) {
    return this.settings.configure(companyId, user.userId, dto);
  }

  @Get(':companyId/items/under-verification') underVerification(
    @Param('companyId', ParseUUIDPipe) companyId: string,
  ) {
    return this.sender.underVerification(companyId);
  }

  @Post(':companyId/items/:itemId/check') check(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.sender.adminCheck(companyId, itemId);
  }
}
