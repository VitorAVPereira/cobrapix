import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  NotEquals,
} from 'class-validator';

const MAX_CENTS = 100_000_000;
const STATUSES = ['PAID', 'REFUNDED', 'CHARGEBACK'] as const;

export class SalesQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsIn(STATUSES) status?: (typeof STATUSES)[number];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class RecoveryQueryDto {
  @IsOptional() @IsIn(['PIX', 'CARD', 'LEAD']) kind?: 'PIX' | 'CARD' | 'LEAD';
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsIn(['OPEN', 'RECOVERED']) state?: 'OPEN' | 'RECOVERED';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class RefundRequestDto {
  @IsString() @Length(5, 1000) reason!: string;
}

export class RejectRefundRequestDto {
  @IsString() @Length(5, 1000) note!: string;
}

// Every admin money entry carries a key from the screen: a double click or a
// retried request records it once.
class AdminMoneyDto {
  @IsUUID('4') idempotencyKey!: string;
  @IsOptional() @IsString() @MaxLength(200) reference?: string;
}

export class PayoutDto extends AdminMoneyDto {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsInt() @Min(1) @Max(MAX_CENTS) amountCents!: number;
  @IsDateString() paidOn!: string;
}

export class OrderMoneyDto extends AdminMoneyDto {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsUUID() orderId!: string;
  @IsInt() @Min(1) @Max(MAX_CENTS) amountCents!: number;
}

export class AdjustmentDto extends AdminMoneyDto {
  @IsOptional() @IsUUID() orderId?: string;
  @IsInt() @Min(-MAX_CENTS) @Max(MAX_CENTS) @NotEquals(0) amountCents!: number;
  @IsString() @Length(5, 1000) note!: string;
}

export class WebhookUrlDto {
  // null turns the webhook off; https is checked by the service.
  @IsOptional() @IsString() @MaxLength(500) url?: string | null;
}

export class PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
