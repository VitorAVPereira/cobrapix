import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
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
import { WEBHOOK_EVENTS } from '../checkout-webhooks.service';

const MAX_CENTS = 100_000_000;
const STATUSES = ['PAID', 'REFUNDED', 'CHARGEBACK'] as const;
const ORDER_STATUSES = [
  'PENDING',
  'PAID',
  'EXPIRED',
  'FAILED',
  'DECLINED',
  'REFUNDED',
  'CHARGEBACK',
] as const;

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
  // Items of the order (indexes); missing or empty is the whole order.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(19, { each: true })
  itemIndexes?: number[];
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

export class WebhookRuleDto {
  @IsString() @Length(1, 80) name!: string;
  // https and a public host are checked by the service.
  @IsString() @MaxLength(500) url!: string;
  // Empty = every event / every product.
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(WEBHOOK_EVENTS, { each: true })
  events?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  productIds?: string[];
}

export class UpdateWebhookRuleDto extends WebhookRuleDto {
  @IsInt() @Min(1) version!: number;
}

export class ApiKeyDto {
  @IsString() @Length(1, 80) name!: string;
}

export class ApiOrdersQueryDto {
  @IsOptional() @IsIn(ORDER_STATUSES) status?: (typeof ORDER_STATUSES)[number];
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsDateString() updatedFrom?: string;
  @IsOptional() @IsDateString() updatedTo?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
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
