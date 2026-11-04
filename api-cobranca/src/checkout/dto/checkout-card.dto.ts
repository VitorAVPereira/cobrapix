import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
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
  ValidateNested,
} from 'class-validator';
import { CheckoutBuyerDto, CheckoutUtmDto } from './checkout-public.dto';

const BRANDS = ['visa', 'mastercard', 'amex', 'elo'] as const;
const STATES = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const;

export class CheckoutCardQuoteDto {
  @IsArray()
  @ArrayMaxSize(6)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  bumpIds!: string[];
  @IsOptional() @IsString() @MaxLength(30) couponCode?: string | null;
  @IsIn(BRANDS) brand!: (typeof BRANDS)[number];
}

/** Sent only to the Efí with the charge; never stored. */
export class CheckoutCardAddressDto {
  @IsString() @Length(2, 200) street!: string;
  @IsString() @Length(1, 55) number!: string;
  @IsString() @Length(1, 255) neighborhood!: string;
  @IsString() @Length(2, 255) city!: string;
  @IsIn(STATES) state!: (typeof STATES)[number];
  @Matches(/^\d{5}-?\d{3}$/, { message: 'Informe o CEP com 8 números.' })
  zipcode!: string;
  @IsOptional() @IsString() @MaxLength(55) complement?: string;
}

class CheckoutCardChargeDto {
  @IsUUID() quoteId!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(12) installments!: number;
  // Opaque token from the Efí library in the browser; the card never comes here.
  @Matches(/^[A-Za-z0-9]{20,100}$/) paymentToken!: string;
  @IsString() @Length(11, 14) holderDocument!: string;
  @ValidateNested()
  @Type(() => CheckoutCardAddressDto)
  address!: CheckoutCardAddressDto;
  @IsUUID('4') idempotencyKey!: string;
}

export class CheckoutCardOrderDto extends CheckoutCardChargeDto {
  @IsArray()
  @ArrayMaxSize(6)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  bumpIds!: string[];
  @IsOptional() @IsString() @MaxLength(30) couponCode?: string | null;
  @ValidateNested() @Type(() => CheckoutBuyerDto) buyer!: CheckoutBuyerDto;
  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutUtmDto)
  utm?: CheckoutUtmDto;
  @IsOptional() @IsUUID('4') sessionKey?: string;
}

export class CheckoutCardPayDto extends CheckoutCardChargeDto {}
