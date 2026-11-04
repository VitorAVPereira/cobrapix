import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CheckoutFinanceService } from './checkout-finance.service';
import { CheckoutRefundsService } from './checkout-refunds.service';
import {
  AdjustmentDto,
  OrderMoneyDto,
  PayoutDto,
  RejectRefundRequestDto,
} from './dto/checkout-finance.dto';

@Controller('admin/checkout/clients/:companyId')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class CheckoutFinanceController {
  constructor(
    private readonly finance: CheckoutFinanceService,
    private readonly refunds: CheckoutRefundsService,
  ) {}

  @Get('finance') overview(
    @Param('companyId', ParseUUIDPipe) companyId: string,
  ) {
    return this.finance.overview(companyId);
  }

  @Post('payouts') payout(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @GetUser() user: AuthenticatedUser,
    @Body() dto: PayoutDto,
  ) {
    return this.finance.payout(companyId, user.userId, dto);
  }

  @Post('refunds') refund(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @GetUser() user: AuthenticatedUser,
    @Body() dto: OrderMoneyDto,
  ) {
    return this.finance.manualRefund(companyId, user.userId, dto);
  }

  @Post('chargebacks') chargeback(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @GetUser() user: AuthenticatedUser,
    @Body() dto: OrderMoneyDto,
  ) {
    return this.finance.chargeback(companyId, user.userId, dto);
  }

  @Post('adjustments') adjustment(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @GetUser() user: AuthenticatedUser,
    @Body() dto: AdjustmentDto,
  ) {
    return this.finance.adjustment(companyId, user.userId, dto);
  }

  @Post('refund-requests/:requestId/reject')
  @HttpCode(204)
  async reject(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @GetUser() user: AuthenticatedUser,
    @Body() dto: RejectRefundRequestDto,
  ): Promise<void> {
    await this.refunds.reject(companyId, requestId, user.userId, dto.note);
  }
}
