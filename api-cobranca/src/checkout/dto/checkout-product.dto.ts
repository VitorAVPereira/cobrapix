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
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const DELIVERY_MODES = ['ACCESS_LINK', 'WEBHOOK', 'BOTH'] as const;
const AFTER_PURCHASE = ['ACCESS', 'OFFER', 'EXTERNAL'] as const;
const OFFER_KINDS = ['UPSELL', 'DOWNSELL'] as const;
const MAX_PRICE_CENTS = 10_000_000;
// 24 hours at most: a leaked one-click link stops selling soon.
export const MIN_OFFER_WINDOW_MINUTES = 15;
export const MAX_OFFER_WINDOW_MINUTES = 1440;

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
  // Page look of this product. Absent keeps what is saved (older screens);
  // null falls back to the checkout settings.
  @IsOptional() @IsUUID() logoAssetId?: string | null;
  @IsOptional() @IsUUID() bannerAssetId?: string | null;
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, {
    message: 'Informe a cor no formato #RRGGBB.',
  })
  primaryColor?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(120) accessPeriodMonths?: number | null;
  @IsIn(DELIVERY_MODES) deliveryMode!: (typeof DELIVERY_MODES)[number];
  @IsOptional() @IsString() @MaxLength(2000) accessUrl?: string | null;
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  accessInstructions?: string | null;
  // Optional so an older screen that does not send them keeps what is saved.
  @IsOptional()
  @IsIn(AFTER_PURCHASE)
  afterPurchase?: (typeof AFTER_PURCHASE)[number];
  @IsOptional() @IsString() @MaxLength(2000) afterPurchaseUrl?: string | null;
  @IsOptional()
  @IsInt()
  @Min(MIN_OFFER_WINDOW_MINUTES)
  @Max(MAX_OFFER_WINDOW_MINUTES)
  offerWindowMinutes?: number;
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
  @IsOptional() @IsString() @MaxLength(120) callToAction?: string | null;
  @IsOptional() @IsString() @MaxLength(300) description?: string | null;
  @IsBoolean() active!: boolean;
}

export class UpdateCheckoutBumpDto extends CheckoutBumpDto {
  @IsInt() @Min(1) expectedVersion!: number;
}

export class CheckoutOfferDto {
  @IsIn(OFFER_KINDS) kind!: (typeof OFFER_KINDS)[number];
  @IsUUID() offeredProductId!: string;
  @IsInt() @Min(1) @Max(MAX_PRICE_CENTS) priceCents!: number;
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PRICE_CENTS)
  compareAtPriceCents?: number | null;
  @IsOptional() @IsString() @MaxLength(120) headline?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @IsBoolean() active!: boolean;
}

export class UpdateCheckoutOfferDto extends CheckoutOfferDto {
  @IsInt() @Min(1) expectedVersion!: number;
}

export class ReorderCheckoutBumpsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  bumpIds!: string[];
}
