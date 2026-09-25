import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
  MinLength,
} from 'class-validator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { OnboardingAdminService } from './onboarding-admin.service';
import { OnboardingLifecycle } from './onboarding-lifecycle';
import { ToBoolean } from '../common/to-boolean';

export class EnabledDto {
  @ToBoolean() @IsBoolean() enabled!: boolean;
}
class ManualRecoveryDto {
  @IsString() @MinLength(1) @MaxLength(128) requestId!: string;
  @IsOptional() @ToBoolean() @IsBoolean() ownershipVerified?: boolean;
  @IsOptional() @Matches(/^\d{14}$/) verifiedCompanyDocument?: string;
  @IsOptional() @IsString() @MaxLength(2_000_000) certificateBase64?: string;
  @IsOptional() @IsString() @MaxLength(256) certificatePassword?: string;
}
@Controller('admin')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class OnboardingAdminController {
  constructor(
    private readonly service: OnboardingAdminService,
    private readonly lifecycle: OnboardingLifecycle,
  ) {}
  @Post('efi-onboarding/:companyId/disconnect')
  async disconnect(
    @Param('companyId') companyId: string,
    @GetUser() user: AuthenticatedUser,
  ): Promise<{ disconnected: boolean }> {
    await this.lifecycle.disconnect(companyId, user.userId);
    return { disconnected: true };
  }
  @Get('efi-onboarding') list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
  ): Promise<unknown> {
    return this.service.list(Math.min(100_000, Math.max(1, page)));
  }
  @Get('efi-onboarding/:companyId') detail(
    @Param('companyId') companyId: string,
  ): Promise<unknown> {
    return this.service.detail(companyId);
  }
  @Post('efi-onboarding/:companyId/retry-provisioning') retry(
    @Param('companyId') companyId: string,
    @GetUser() user: AuthenticatedUser,
  ): Promise<unknown> {
    return this.service.retry(companyId, user.userId);
  }
  @Post('efi-onboarding/:companyId/manual') manual(
    @Param('companyId') companyId: string,
    @GetUser() user: AuthenticatedUser,
    @Body() body: ManualRecoveryDto,
  ): Promise<unknown> {
    return this.service.manual(companyId, user.userId, body);
  }
  @Post('efi-onboarding/:companyId/validate') validate(
    @Param('companyId') companyId: string,
  ): Promise<unknown> {
    return this.service.validate(companyId);
  }
  @Put('integrations/efi-onboarding') opening(
    @Body() body: EnabledDto,
  ): Promise<unknown> {
    return this.service.setEnabled('EFI_ONBOARDING', body.enabled);
  }
  @Put('integrations/efi-payments') payments(
    @Body() body: EnabledDto,
  ): Promise<unknown> {
    return this.service.setEnabled('EFI_PAYMENTS', body.enabled);
  }
  @Get('integrations/health') health(): Promise<unknown> {
    return this.service.integrationHealth();
  }
  @Put('integrations/meta') meta(@Body() body: EnabledDto): Promise<unknown> {
    return this.service.setEnabled('META', body.enabled);
  }
  @Put('integrations/resend') resend(
    @Body() body: EnabledDto,
  ): Promise<unknown> {
    return this.service.setEnabled('RESEND', body.enabled);
  }
}
