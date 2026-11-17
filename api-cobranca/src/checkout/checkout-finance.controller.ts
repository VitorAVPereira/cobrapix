import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CheckoutFinanceService } from './checkout-finance.service';
import { CheckoutRefundsService } from './checkout-refunds.service';
import { CheckoutRefundExecutionsService } from './checkout-refund-executions.service';
import { CheckoutSubscriptionsService } from './checkout-subscriptions.service';
import {
  AdjustmentDto,
  ExecuteRefundDto,
  OrderMoneyDto,
  PageQueryDto,
  PayoutDto,
  RejectRefundRequestDto,
} from './dto/checkout-finance.dto';

@Controller('admin/checkout/clients/:companyId')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class CheckoutFinanceController {
  constructor(
    private readonly finance: CheckoutFinanceService,
    private readonly refunds: CheckoutRefundsService,
    private readonly subscriptions: CheckoutSubscriptionsService,
    private readonly executions: CheckoutRefundExecutionsService,
  ) {}

  // The Efí returns the money from the seller's own account, with its ok.
  @Post('refund-executions')
  @HttpCode(200)
  executeRefund(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @GetUser() user: AuthenticatedUser,
    @Body() dto: ExecuteRefundDto,
  ) {
    return this.executions.execute(companyId, dto.orderId, {
      origin: 'ADMIN',
      userId: user.userId,
      approvalReference: dto.approvalReference,
    });
  }

  @Get('subscriptions') listSubscriptions(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: PageQueryDto,
  ) {
    return this.subscriptions.list(
      companyId,
      query.page ?? 1,
      query.pageSize ?? 20,
    );
  }

  @Post('subscriptions/:id/cancel')
  @HttpCode(204)
  async cancelSubscription(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.subscriptions.cancel(companyId, id, 'ADMIN', user.userId);
  }

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
