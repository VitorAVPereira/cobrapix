import { IsIn, IsOptional, IsString } from 'class-validator';
import {
  DASHBOARD_PERIODS,
  type DashboardPeriodKey,
} from '../dashboard-period';

export class CompanyDashboardQueryDto {
  @IsOptional()
  @IsIn(DASHBOARD_PERIODS)
  period?: DashboardPeriodKey;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}
