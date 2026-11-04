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
}
