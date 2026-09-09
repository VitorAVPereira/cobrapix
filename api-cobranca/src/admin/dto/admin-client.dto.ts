import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsBoolean,
  IsDateString,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CreateGatewayAccountDto } from '../../payment/dto/gateway-account.dto';
import { ConfigureMetaWhatsappDto } from '../../whatsapp/dto/configure-meta-whatsapp.dto';

const COMPANY_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
const BILLING_METHODS = ['PIX', 'BOLETO', 'BOLIX'] as const;
const BUSINESS_SEGMENTS = ['GENERAL', 'EDUCATION'] as const;
const WHATSAPP_PROVIDERS = ['META_CLOUD'] as const;
const WHATSAPP_STATUSES = ['CONNECTED', 'DISCONNECTED', 'PENDING'] as const;
const MESSAGING_LIMIT_TIERS = [
  'TIER_50',
  'TIER_250',
  'TIER_1K',
  'TIER_10K',
  'TIER_100K',
  'TIER_UNLIMITED',
] as const;
const GATEWAY_STATUSES = ['PENDING', 'ACTIVE', 'REJECTED', 'DISABLED'] as const;

export class AdminCompanyDto {
  @IsString()
  @Length(2, 160)
  corporateName!: string;

  @IsString()
  @Length(11, 18)
  document!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @Length(10, 24)
  phoneNumber!: string;

  @IsOptional()
  @IsIn(COMPANY_STATUSES)
  status?: (typeof COMPANY_STATUSES)[number];
}

export class AdminFirstUserDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsEmail()
  email!: string;
}

export class AdminBillingDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsIn(BILLING_METHODS, { each: true })
  enabledBillingMethods!: Array<(typeof BILLING_METHODS)[number]>;

  @IsIn(BILLING_METHODS)
  preferredBillingMethod!: (typeof BILLING_METHODS)[number];

  @IsInt()
  @Min(0)
  @Max(9999)
  onTimeSplitPercentageBps!: number;

  @IsInt()
  @Min(0)
  @Max(9999)
  overdueSplitPercentageBps!: number;
}

export class AdminCompanyUpdateDto {
  @IsOptional()
  @IsString()
  @Length(2, 160)
  corporateName?: string;

  @IsOptional()
  @IsString()
  @Length(11, 18)
  document?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Length(10, 24)
  phoneNumber?: string;

  @IsOptional()
  @IsIn(COMPANY_STATUSES)
  status?: (typeof COMPANY_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(40)
  gatewayProvider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  gatewayStatus?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  legalRepresentative?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(18)
  legalRepresentativeCpf?: string | null;

  @IsOptional()
  @IsDateString()
  legalRepresentativeBirthDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  addressPostalCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  addressStreet?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  addressNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  addressDistrict?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  addressCity?: string | null;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  addressState?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  bankAgency?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  bankAccount?: string | null;
}

export class AdminBillingUpdateDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsIn(BILLING_METHODS, { each: true })
  enabledBillingMethods?: Array<(typeof BILLING_METHODS)[number]>;

  @IsOptional()
  @IsIn(BILLING_METHODS)
  preferredBillingMethod?: (typeof BILLING_METHODS)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  onTimeSplitPercentageBps?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  overdueSplitPercentageBps?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(99)
  maxDiscountsPerDebtor?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  discountTriggerDay?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  collectionReminderDays?: number[];

  @IsOptional()
  @IsBoolean()
  autoGenerateFirstCharge?: boolean;

  @IsOptional()
  @IsBoolean()
  autoDiscountEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  autoDiscountDaysAfterDue?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  autoDiscountPercentage?: number | null;
}

export class AdminNotificationsDto {
  @IsOptional()
  @IsIn(BUSINESS_SEGMENTS)
  businessSegment?: (typeof BUSINESS_SEGMENTS)[number];

  @IsOptional()
  @IsBoolean()
  paymentNotificationEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsEmail({}, { each: true })
  paymentNotificationEmails?: string[];
}

export class AdminWhatsappUpdateDto {
  @IsOptional()
  @IsIn(WHATSAPP_PROVIDERS)
  whatsappProvider?: (typeof WHATSAPP_PROVIDERS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(80)
  whatsappInstanceId?: string | null;

  @IsOptional()
  @IsIn(WHATSAPP_STATUSES)
  whatsappStatus?: (typeof WHATSAPP_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(80)
  metaPhoneNumberId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  metaBusinessAccountId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  metaBusinessPhoneNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  metaDefaultLanguage?: string;

  @IsOptional()
  @IsIn(MESSAGING_LIMIT_TIERS)
  messagingLimitTier?: (typeof MESSAGING_LIMIT_TIERS)[number] | null;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  metaAccessToken?: string;
}

export class AdminIntegrationsDto {
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  resendApiKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  resendWebhookSecret?: string;

  @IsOptional()
  @IsEmail()
  resendFromEmail?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  erpApiKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  erpWebhookUrl?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  erpEnabledEvents?: string[];
}

export class AdminEfiUpdateDto {
  @IsOptional()
  @IsIn(['homologation', 'production'])
  environment?: 'homologation' | 'production';

  @IsOptional()
  @IsIn(GATEWAY_STATUSES)
  status?: (typeof GATEWAY_STATUSES)[number];

  @IsOptional()
  @IsIn(GATEWAY_STATUSES)
  gatewayStatus?: (typeof GATEWAY_STATUSES)[number];

  @IsOptional()
  @IsString()
  efiPayeeCode?: string;

  @IsOptional()
  @IsString()
  efiAccountNumber?: string;

  @IsOptional()
  @IsString()
  efiAccountDigit?: string | null;

  @IsOptional()
  @IsString()
  efiPixKey?: string;

  @IsOptional()
  @IsString()
  efiClientId?: string;

  @IsOptional()
  @IsString()
  efiClientSecret?: string;

  @IsOptional()
  @IsString()
  efiCertificatePath?: string | null;

  @IsOptional()
  @IsString()
  efiCertificatePassword?: string;

  @IsOptional()
  @IsString()
  efiCertificateBase64?: string;
}

export class CreateAdminClientDto {
  @ValidateNested()
  @Type(() => AdminCompanyDto)
  company!: AdminCompanyDto;

  @ValidateNested()
  @Type(() => AdminFirstUserDto)
  firstUser!: AdminFirstUserDto;

  @ValidateNested()
  @Type(() => AdminBillingDto)
  billing!: AdminBillingDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConfigureMetaWhatsappDto)
  meta?: ConfigureMetaWhatsappDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateGatewayAccountDto)
  efi?: CreateGatewayAccountDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AdminIntegrationsDto)
  integrations?: AdminIntegrationsDto;
}

export class UpdateAdminClientDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => AdminCompanyUpdateDto)
  company?: AdminCompanyUpdateDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AdminBillingUpdateDto)
  billing?: AdminBillingUpdateDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AdminNotificationsDto)
  notifications?: AdminNotificationsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AdminWhatsappUpdateDto)
  whatsapp?: AdminWhatsappUpdateDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AdminIntegrationsDto)
  integrations?: AdminIntegrationsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConfigureMetaWhatsappDto)
  meta?: ConfigureMetaWhatsappDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AdminEfiUpdateDto)
  efi?: AdminEfiUpdateDto;
}
