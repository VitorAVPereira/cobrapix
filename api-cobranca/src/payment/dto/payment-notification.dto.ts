import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import {
  DASHBOARD_PERIODS,
  type DashboardPeriodKey,
} from '../../billing/dashboard-period';

export const PAYMENT_NOTIFICATION_STATES = [
  'unread',
  'read',
  'email_failed',
] as const;
export type PaymentNotificationState =
  (typeof PAYMENT_NOTIFICATION_STATES)[number];

export const PAYMENT_NOTIFICATION_BILLING_TYPES = [
  'PIX',
  'BOLETO',
  'CREDIT_CARD',
] as const;
export type PaymentNotificationBillingType =
  (typeof PAYMENT_NOTIFICATION_BILLING_TYPES)[number];

/** Filters shared by the list and by "mark all as read". */
export class PaymentNotificationFilterDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(PAYMENT_NOTIFICATION_STATES)
  state?: PaymentNotificationState;

  @IsOptional()
  @IsIn(PAYMENT_NOTIFICATION_BILLING_TYPES)
  billingType?: PaymentNotificationBillingType;

  /** Payment date in São Paulo; empty means any date. */
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

export class PaymentNotificationListQueryDto extends PaymentNotificationFilterDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([20, 50, 100])
  pageSize = 20;
}

export class MarkPaymentNotificationsReadDto extends PaymentNotificationFilterDto {
  /** Selected rows; at most one page. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  ids?: string[];

  /**
   * "Mark all" covers only what the list showed: notifications created up to
   * the `asOf` of that list, so a payment that arrived meanwhile stays new.
   */
  @IsOptional()
  @IsISO8601({ strict: true })
  asOf?: string;
}
