import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SettlementsService } from './settlements.service';
import { CompanyReceiptsQueryDto } from './settlements.dto';

// The company comes from the session, never from the request. Read-only.
@Controller('financial')
@UseGuards(JwtAuthGuard)
export class CompanyFinancialController {
  constructor(private readonly settlements: SettlementsService) {}

  @Get('receipts')
  receipts(
    @GetUser() user: AuthenticatedUser,
    @Query() query: CompanyReceiptsQueryDto,
  ) {
    return this.settlements.companyOverview(user.companyId, query);
  }
}
