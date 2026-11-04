import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

const FEE_PAYERS = ['BUYER', 'SELLER'] as const;
const PHONE = /^\d{10,11}$/;
const PHONE_MESSAGE = 'Informe o telefone com DDD, somente números.';

// PUT replaces the whole page configuration; null clears an optional field.
export class UpdateCheckoutSettingsDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @Length(2, 80) displayName!: string;
  @IsOptional() @IsUUID() logoAssetId?: string | null;
  @IsOptional() @IsUUID() bannerAssetId?: string | null;
  @Matches(/^#[0-9a-fA-F]{6}$/, {
    message: 'Informe a cor no formato #RRGGBB.',
  })
  primaryColor!: string;
  @IsOptional() @IsEmail() supportEmail?: string | null;
  @IsOptional()
  @Matches(PHONE, { message: PHONE_MESSAGE })
  supportWhatsapp?: string | null;
  @IsOptional()
  @Matches(PHONE, { message: PHONE_MESSAGE })
  whatsappButtonPhone?: string | null;
  @IsBoolean() pixEnabled!: boolean;
  @IsBoolean() cardEnabled!: boolean;
  @IsInt() @Min(1) @Max(12) maxInstallments!: number;
  @IsIn(FEE_PAYERS) pixFeePayer!: (typeof FEE_PAYERS)[number];
  @IsIn(FEE_PAYERS) cardFeePayer!: (typeof FEE_PAYERS)[number];
}

export class UploadCheckoutAssetDto {
  @IsIn(['LOGO', 'BANNER', 'PRODUCT_IMAGE'])
  kind!: 'LOGO' | 'BANNER' | 'PRODUCT_IMAGE';
}
