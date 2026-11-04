import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

const COUPON_TYPES = ['PERCENT', 'FIXED'] as const;

export class CheckoutCouponDto {
  @Matches(/^[A-Za-z0-9_-]{3,30}$/, {
    message: 'Use de 3 a 30 letras, números, "-" ou "_" no código.',
  })
  code!: string;
  @IsIn(COUPON_TYPES) type!: (typeof COUPON_TYPES)[number];
  // Basis points for PERCENT (100 = 1%), cents for FIXED.
  @IsInt() @Min(1) @Max(10_000_000) value!: number;
  @IsBoolean() appliesToAllProducts!: boolean;
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  productIds!: string[];
  @IsOptional() @IsDateString() startsAt?: string | null;
  @IsOptional() @IsDateString() expiresAt?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(1_000_000) maxUses?: number | null;
  @IsBoolean() active!: boolean;
}

export class UpdateCheckoutCouponDto extends CheckoutCouponDto {
  @IsInt() @Min(1) expectedVersion!: number;
}
