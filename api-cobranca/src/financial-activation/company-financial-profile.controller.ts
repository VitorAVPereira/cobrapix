import { Controller, Get, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CompanyFinancialProfile,
  CompanyFinancialProfileService,
} from './company-financial-profile.service';

// The company comes from the session, never from the request.
@Controller('financial-profile')
@UseGuards(JwtAuthGuard)
export class CompanyFinancialProfileController {
  constructor(private readonly service: CompanyFinancialProfileService) {}

  @Get()
  get(@GetUser() user: AuthenticatedUser): Promise<CompanyFinancialProfile> {
    return this.service.get(user.companyId);
  }
}
