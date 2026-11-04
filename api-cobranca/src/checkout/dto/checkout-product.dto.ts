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
  MaxLength,
  Min,
} from 'class-validator';

const DELIVERY_MODES = ['ACCESS_LINK', 'WEBHOOK', 'BOTH'] as const;
const MAX_PRICE_CENTS = 10_000_000;

export class CheckoutProductDto {
  @IsString() @Length(2, 120) name!: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string | null;
  @IsInt() @Min(1) @Max(MAX_PRICE_CENTS) priceCents!: number;
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PRICE_CENTS)
  compareAtPriceCents?: number | null;
  @IsOptional() @IsUUID() imageAssetId?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(120) accessPeriodMonths?: number | null;
  @IsIn(DELIVERY_MODES) deliveryMode!: (typeof DELIVERY_MODES)[number];
  @IsOptional() @IsString() @MaxLength(2000) accessUrl?: string | null;
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  accessInstructions?: string | null;
}

export class UpdateCheckoutProductDto extends CheckoutProductDto {
  @IsInt() @Min(1) expectedVersion!: number;
}

export class SetCheckoutActiveDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsBoolean() active!: boolean;
}

export class ListCheckoutProductsQueryDto {
  @IsOptional() @IsIn(['true', 'false']) active?: 'true' | 'false';
}

export class CheckoutBumpDto {
  @IsUUID() offeredProductId!: string;
  @IsInt() @Min(1) @Max(MAX_PRICE_CENTS) priceCents!: number;
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PRICE_CENTS)
  compareAtPriceCents?: number | null;
  @IsOptional() @IsString() @MaxLength(80) headline?: string | null;
  @IsOptional() @IsString() @MaxLength(300) description?: string | null;
  @IsBoolean() active!: boolean;
}

export class UpdateCheckoutBumpDto extends CheckoutBumpDto {
  @IsInt() @Min(1) expectedVersion!: number;
}

export class ReorderCheckoutBumpsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  bumpIds!: string[];
}
