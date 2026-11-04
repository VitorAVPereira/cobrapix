import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class CheckoutQuoteDto {
  @IsArray()
  @ArrayMaxSize(6)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  bumpIds!: string[];
  @IsOptional() @IsString() @MaxLength(30) couponCode?: string | null;
  @IsIn(['PIX']) method!: 'PIX';
}

export class CheckoutBuyerDto {
  @IsString() @Length(3, 120) name!: string;
  @IsEmail() @MaxLength(160) email!: string;
  @IsString() @Length(11, 18) document!: string;
  @Matches(/^\d{10,11}$/, {
    message: 'Informe o celular com DDD, somente números.',
  })
  phone!: string;
}

export class CheckoutUtmDto {
  @IsOptional() @IsString() @MaxLength(100) utm_source?: string;
  @IsOptional() @IsString() @MaxLength(100) utm_medium?: string;
  @IsOptional() @IsString() @MaxLength(100) utm_campaign?: string;
  @IsOptional() @IsString() @MaxLength(100) utm_term?: string;
  @IsOptional() @IsString() @MaxLength(100) utm_content?: string;
}

export class CreateCheckoutOrderDto extends CheckoutQuoteDto {
  @ValidateNested() @Type(() => CheckoutBuyerDto) buyer!: CheckoutBuyerDto;
  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutUtmDto)
  utm?: CheckoutUtmDto;
  // Sent again by a double click or a retried request: same order back.
  @IsUUID('4') idempotencyKey!: string;
  // The visit that typed the data, so its lead counts as converted.
  @IsOptional() @IsUUID('4') sessionKey?: string;
}

/** Partial data typed on the page; every field is optional until the order. */
export class CheckoutLeadDto {
  @IsUUID('4') sessionKey!: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(160) email?: string;
  @IsOptional() @IsString() @MaxLength(18) document?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutUtmDto)
  utm?: CheckoutUtmDto;
}
