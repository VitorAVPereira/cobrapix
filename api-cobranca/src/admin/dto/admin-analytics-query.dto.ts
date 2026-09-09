import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const ADMIN_ANALYTICS_PERIODS = [
  'current_month',
  'today',
  '7d',
  '30d',
  'year',
  'custom',
] as const;

export type AdminAnalyticsPeriod = (typeof ADMIN_ANALYTICS_PERIODS)[number];

export class AdminAnalyticsQueryDto {
  @IsOptional()
  @IsIn(ADMIN_ANALYTICS_PERIODS)
  period?: AdminAnalyticsPeriod;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
