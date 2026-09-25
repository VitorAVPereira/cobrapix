import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SettlementsService } from './settlements.service';

// The company comes from the session, never from the request. Read-only.
@Controller('financial')
@UseGuards(JwtAuthGuard)
export class CompanyFinancialController {
  constructor(private readonly settlements: SettlementsService) {}

  @Get('receipts')
  receipts(
    @GetUser() user: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const parse = (value: string | undefined, fallback: number) => {
      const parsed = Number.parseInt(value ?? '', 10);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
    };
    return this.settlements.companyOverview(
      user.companyId,
      parse(page, 1),
      Math.min(parse(pageSize, 20), 100),
    );
  }
}
