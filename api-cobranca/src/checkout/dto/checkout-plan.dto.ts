import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

export const PLAN_INTERVALS = [1, 3, 6, 12] as const;
const BILLING = ['INSTALLMENT', 'RECURRING'] as const;
const FEE_PAYERS = ['BUYER', 'SELLER'] as const;
const MAX_PRICE_CENTS = 10_000_000;

export class CheckoutPlanDto {
  @IsString() @Length(2, 60) name!: string;
  @IsIn(PLAN_INTERVALS) intervalMonths!: (typeof PLAN_INTERVALS)[number];
  @IsIn(BILLING) billing!: (typeof BILLING)[number];
  @IsInt() @Min(1) @Max(MAX_PRICE_CENTS) priceCents!: number;
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PRICE_CENTS)
  compareAtPriceCents?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(12) maxInstallments?: number | null;
  // Empty follows the checkout settings.
  @IsOptional() @IsIn(FEE_PAYERS) pixFeePayer?:
    | (typeof FEE_PAYERS)[number]
    | null;
  @IsOptional() @IsIn(FEE_PAYERS) cardFeePayer?:
    | (typeof FEE_PAYERS)[number]
    | null;
  @IsBoolean() active!: boolean;
}

export class CreateCheckoutPlanDto extends CheckoutPlanDto {
  @IsUUID() productId!: string;
}

export class UpdateCheckoutPlanDto extends CheckoutPlanDto {
  @IsInt() @Min(1) expectedVersion!: number;
}

export class ListCheckoutPlansQueryDto {
  @IsOptional() @IsUUID() productId?: string;
}

export class ReorderCheckoutPlansDto {
  @IsUUID() productId!: string;
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  planIds!: string[];
}

/** What the seller is typing; nothing is saved. */
export class CheckoutPlanPreviewDto {
  @IsIn(BILLING) billing!: (typeof BILLING)[number];
  @IsInt() @Min(1) @Max(MAX_PRICE_CENTS) priceCents!: number;
  @IsOptional() @IsInt() @Min(1) @Max(12) maxInstallments?: number | null;
}
