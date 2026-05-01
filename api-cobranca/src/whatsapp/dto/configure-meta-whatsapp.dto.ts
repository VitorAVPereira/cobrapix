import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ConfigureMetaWhatsappDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  phoneNumberId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  businessAccountId!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(40)
  accessToken!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  businessPhoneNumber?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z]{2}_[A-Z]{2}$/)
  defaultLanguage?: string;
}
