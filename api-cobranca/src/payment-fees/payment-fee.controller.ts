import {
  Body,
  DefaultValuePipe,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import {
  CreatePaymentFeeVersionDto,
  PaymentFeeQueryDto,
} from './payment-fee.dto';
import { PaymentFeeService } from './payment-fee.service';

@Controller('payments/fees')
@UseGuards(JwtAuthGuard)
export class PaymentFeeController {
  constructor(private readonly fees: PaymentFeeService) {}

  @Get()
  async quote(
    @GetUser() user: AuthenticatedUser,
    @Query() query: PaymentFeeQueryDto,
  ) {
    const quote = await this.fees.quote(
      user.companyId,
      query.billingMethod,
      query.amountCents,
    );
    return {
      billingMethod: quote.billingMethod,
      grossAmountCents: quote.grossAmountCents,
      totalFeeCents: quote.totalFeeCents,
      netAmountCents: quote.netAmountCents,
      feeLabel: quote.feeLabel,
      feeVersionId: quote.feeVersionId,
      feeVersion: quote.feeVersion,
    };
  }
}

@Controller('admin/payment-fees')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class AdminPaymentFeeController {
  constructor(private readonly fees: PaymentFeeService) {}

  @Get('alerts')
  async alerts(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
  ): Promise<unknown> {
    return this.fees.listDivergences(Math.max(1, Math.min(100000, page)));
  }

  @Get()
  async listGlobal() {
    return this.fees.listVersions();
  }

  @Post('versions')
  async createGlobal(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: CreatePaymentFeeVersionDto,
  ) {
    return this.fees.createVersion(null, {
      ...dto,
      createdByUserId: user.userId,
    });
  }

  @Get(':companyId')
  async listCompany(@Param('companyId') companyId: string) {
    return this.fees.listVersions(companyId);
  }

  @Post(':companyId/versions')
  async createCompany(
    @GetUser() user: AuthenticatedUser,
    @Param('companyId') companyId: string,
    @Body() dto: CreatePaymentFeeVersionDto,
  ) {
    return this.fees.createVersion(companyId, {
      ...dto,
      createdByUserId: user.userId,
    });
  }
}
