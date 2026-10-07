import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEmail,
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
import type { CardBrand } from '../efi-card.client';
export class CardQuoteDto {
  @IsIn(['visa', 'mastercard', 'amex', 'elo']) brand!: CardBrand;
}
export class CardAddressDto {
  @IsString() @Length(1, 100) street!: string;
  @IsString() @Length(1, 20) number!: string;
  @IsString() @Length(1, 100) neighborhood!: string;
  @IsString() @Length(1, 100) city!: string;
  @Matches(
    /^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/,
  )
  state!: string;
  @Matches(/^\d{8}$/) zipcode!: string;
  @IsOptional() @IsString() @MaxLength(100) complement?: string;
}
export class CardLegalPersonDto {
  @IsString() @Length(2, 100) corporate_name!: string;
  @Matches(/^\d{14}$/) cnpj!: string;
}
export class CardCustomerDto {
  @IsString() @Length(2, 100) name!: string;
  @Matches(/^\d{11}$/) cpf!: string;
  @IsEmail() @MaxLength(200) email!: string;
  @Matches(/^\d{10,11}$/) phone_number!: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) birth?: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => CardLegalPersonDto)
  juridical_person?: CardLegalPersonDto;
}
export class CardPayDto {
  @IsUUID() quoteId!: string;
  @IsInt() @Min(1) @Max(6) installments!: number;
  @IsString()
  @Length(10, 512)
  @Matches(/^[A-Za-z0-9_-]+$/)
  paymentToken!: string;
  @IsDefined()
  @ValidateNested()
  @Type(() => CardCustomerDto)
  customer!: CardCustomerDto;
  @IsDefined()
  @ValidateNested()
  @Type(() => CardAddressDto)
  billingAddress!: CardAddressDto;
}
export class CardProcessingRateDto {
  @IsIn(['visa', 'mastercard', 'amex', 'elo']) brand!: CardBrand;
  @IsInt() @Min(1) @Max(6) installments!: number;
  @IsInt() @Min(0) @Max(9999) basisPoints!: number;
  @IsInt() @Min(0) @Max(2147483647) fixedCents!: number;
}
export class CardSettingsDto {
  @IsUUID() issuerIdentityId!: string;
  @IsInt() @Min(0) expectedVersion!: number;
  @IsBoolean() enabled!: boolean;
  @IsInt() @Min(0) @Max(10000) onTimeBasisPoints!: number;
  @IsInt() @Min(0) @Max(10000) overdueBasisPoints!: number;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => CardProcessingRateDto)
  processingRates!: CardProcessingRateDto[];
  @IsString()
  @Length(3, 200)
  @Matches(/^[\p{L}\p{N} ._:/-]+$/u)
  validationReference!: string;
}
