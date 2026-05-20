import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { CreateGatewayAccountDto } from '../../payment/dto/gateway-account.dto';
import { ConfigureMetaWhatsappDto } from '../../whatsapp/dto/configure-meta-whatsapp.dto';

const COMPANY_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
const BILLING_METHODS = ['PIX', 'BOLETO', 'BOLIX'] as const;

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

  @IsString()
  @Length(8, 120)
  password!: string;
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
}

export class UpdateAdminClientDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => AdminCompanyDto)
  company?: AdminCompanyDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AdminBillingDto)
  billing?: AdminBillingDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConfigureMetaWhatsappDto)
  meta?: ConfigureMetaWhatsappDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateGatewayAccountDto)
  efi?: CreateGatewayAccountDto;
}

export class ResetClientPasswordDto {
  @IsOptional()
  @IsString()
  @Length(8, 120)
  password?: string;
}
