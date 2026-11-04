import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ToBoolean } from '../../common/to-boolean';

// Multipart form: numbers and booleans arrive as text.
export class UploadPlatformCredentialsDto {
  @IsIn(['HOMOLOGATION', 'PRODUCTION'])
  environment!: 'HOMOLOGATION' | 'PRODUCTION';
  @IsString() @Matches(/^[\x21-\x7e]{1,256}$/) clientId!: string;
  @IsString() @Matches(/^[\x21-\x7e]{1,256}$/) clientSecret!: string;
  @IsOptional() @IsString() @MaxLength(256) certificatePassword?: string;
  @Matches(/^\d{14}$/) holderDocument!: string;
  @Matches(/^\d{1,20}$/) efiAccountNumber!: string;
  @IsOptional() @Matches(/^[0-9Xx]{1,2}$/) efiAccountDigit?: string;
  @Matches(/^[A-Za-z0-9]{1,64}$/) payeeCode!: string;
  @IsString() @MinLength(1) @MaxLength(77) pixKey!: string;
}

export class ValidatePlatformAccountDto {
  // The Efí keeps one webhook per Pix key: replacing another one needs a yes.
  @IsOptional() @ToBoolean() @IsBoolean() confirmOverwrite?: boolean;
}

export class SetPlatformCardDto {
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;
  @IsBoolean() cardEnabled!: boolean;
  // Cash (1x) tariff, up to 20%.
  @Type(() => Number) @IsInt() @Min(0) @Max(2000) cashBasisPoints!: number;
  // Anticipation per installment after the first, up to 10%.
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  anticipationBasisPoints!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(60) cardCreditDays!: number;
}

export class SetPlatformPixFeeDto {
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;
  // Up to 10% of each Pix, in basis points.
  @Type(() => Number) @IsInt() @Min(0) @Max(1000) pixFeeBasisPoints!: number;
}
