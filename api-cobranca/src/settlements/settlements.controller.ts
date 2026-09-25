import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PaymentSettlementStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import {
  RecordPlatformFeeEvidenceDto,
  ResolveDivergenceDto,
  SETTLEMENT_STATUSES,
  SettlementOptionsDto,
} from './settlements.dto';
import { SettlementsService } from './settlements.service';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller('admin')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class SettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @Get('settlements')
  list(
    @Query('companyId') companyId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.settlements.list({
      companyId: this.optionalUuid(companyId),
      status: this.optionalStatus(status),
      page: this.positive(page, 1),
      pageSize: Math.min(this.positive(pageSize, 20), 100),
    });
  }

  @Get('settlements/summary')
  summary(@Query('companyId') companyId?: string) {
    return this.settlements.summary(this.optionalUuid(companyId));
  }

  @Get('settlements/:settlementId')
  detail(@Param('settlementId', ParseUUIDPipe) settlementId: string) {
    return this.settlements.detail(settlementId);
  }

  @Post('settlements/platform-fee-evidence')
  @HttpCode(200)
  recordEvidence(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: RecordPlatformFeeEvidenceDto,
  ) {
    return this.settlements.recordPlatformFeeEvidence(user.userId, dto);
  }

  @Post('settlements/divergences/:divergenceId/resolve')
  @HttpCode(200)
  resolve(
    @GetUser() user: AuthenticatedUser,
    @Param('divergenceId', ParseUUIDPipe) divergenceId: string,
    @Body() dto: ResolveDivergenceDto,
  ) {
    return this.settlements.resolveDivergence(user.userId, divergenceId, dto);
  }

  @Put('companies/:companyId/settlement-options')
  updateOptions(
    @GetUser() user: AuthenticatedUser,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: SettlementOptionsDto,
  ) {
    return this.settlements.updateOptions(
      user.userId,
      companyId,
      dto.refundPlatformFeeOnRefund,
    );
  }

  private optionalUuid(value?: string): string | undefined {
    if (!value) return undefined;
    if (!UUID.test(value)) throw new HttpException('Empresa inválida.', 400);
    return value;
  }

  private optionalStatus(value?: string): PaymentSettlementStatus | undefined {
    if (!value) return undefined;
    if (!(SETTLEMENT_STATUSES as readonly string[]).includes(value))
      throw new HttpException('Situação inválida.', 400);
    return value as PaymentSettlementStatus;
  }

  private positive(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }
}
