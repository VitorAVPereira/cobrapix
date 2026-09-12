import {
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { EfiService } from './efi.service';

@Controller('admin/payment-charges')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PaymentAdminController {
  constructor(private readonly efi: EfiService) {}

  @Post(':companyId/:chargeId/reconcile')
  reconcile(
    @GetUser() user: AuthenticatedUser,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('chargeId', ParseUUIDPipe) chargeId: string,
  ): Promise<{ status: string }> {
    return this.efi.reconcileCharge(companyId, chargeId, user.userId);
  }
}
