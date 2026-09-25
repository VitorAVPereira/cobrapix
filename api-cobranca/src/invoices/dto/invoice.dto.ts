import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { ToBoolean } from '../../common/to-boolean';

export type BillingType = 'PIX' | 'BOLETO' | 'BOLIX';

export class CreateInvoiceDto {
  @IsOptional()
  @IsString()
  debtorId?: string;

  @ValidateIf((dto: CreateInvoiceDto) => !dto.debtorId)
  @IsString()
  @Length(2, 120)
  name?: string;

  @ValidateIf((dto: CreateInvoiceDto) => !dto.debtorId)
  @IsString()
  document?: string;

  @ValidateIf((dto: CreateInvoiceDto) => !dto.debtorId)
  @Matches(/^\+?[\d\s().-]{10,24}$/)
  phone_number?: string;

  @ValidateIf((dto: CreateInvoiceDto) => !dto.debtorId)
  @IsEmail()
  email?: string;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  whatsappOptIn?: boolean;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999999.99)
  original_amount!: number;

  @ValidateIf((dto: CreateInvoiceDto) => dto.recurring !== true)
  @IsString()
  due_date?: string;

  @IsIn(['PIX', 'BOLIX'])
  billing_type!: BillingType;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  recurring?: boolean;

  @ValidateIf((dto: CreateInvoiceDto) => dto.recurring === true)
  @IsInt()
  @Min(1)
  @Max(31)
  due_day?: number;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  studentName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  studentEnrollment?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  studentGroup?: string;
}

export class CreateDebtorInvoiceDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999999.99)
  original_amount!: number;

  @ValidateIf((dto: CreateDebtorInvoiceDto) => dto.recurring !== true)
  @IsString()
  due_date?: string;

  @IsIn(['PIX', 'BOLIX'])
  billing_type!: BillingType;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  recurring?: boolean;

  @ValidateIf((dto: CreateDebtorInvoiceDto) => dto.recurring === true)
  @IsInt()
  @Min(1)
  @Max(31)
  due_day?: number;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  studentName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  studentEnrollment?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  studentGroup?: string;
}

export class CreateDebtorDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsString()
  document!: string;

  @Matches(/^\+?[\d\s().-]{10,24}$/)
  phone_number!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  whatsappOptIn?: boolean;

  @IsOptional()
  @IsUUID('4')
  collectionProfileId?: string;
}

export class UpdateDebtorDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsString()
  document?: string;

  @IsOptional()
  @Matches(/^\+?[\d\s().-]{10,24}$/)
  phone_number?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  whatsappOptIn?: boolean;

  @IsOptional()
  @IsUUID('4')
  collectionProfileId?: string;
}

export class UpdateRecurringInvoiceDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999999.99)
  amount!: number;

  @IsIn(['PIX', 'BOLIX'])
  billingType!: BillingType;

  @IsInt()
  @Min(1)
  @Max(31)
  dueDay!: number;
}

export class UpdateDebtorSettingsDto {
  @IsOptional()
  @IsString()
  document?: string;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  useGlobalBillingSettings?: boolean;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  whatsappOptIn?: boolean;

  @IsOptional()
  @IsIn(['PIX', 'BOLIX'])
  preferredBillingMethod?: BillingType;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(-30, { each: true })
  @Max(365, { each: true })
  collectionReminderDays?: number[];

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  autoGenerateFirstCharge?: boolean;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  autoDiscountEnabled?: boolean;

  @ValidateIf(
    (dto: UpdateDebtorSettingsDto) =>
      dto.autoDiscountEnabled === true ||
      (dto.autoDiscountDaysAfterDue !== undefined &&
        dto.autoDiscountDaysAfterDue !== null),
  )
  @IsInt()
  @Min(0)
  @Max(365)
  autoDiscountDaysAfterDue?: number;

  @ValidateIf(
    (dto: UpdateDebtorSettingsDto) =>
      dto.autoDiscountEnabled === true ||
      (dto.autoDiscountPercentage !== undefined &&
        dto.autoDiscountPercentage !== null),
  )
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100)
  autoDiscountPercentage?: number;

  @IsOptional()
  @IsUUID('4')
  collectionProfileId?: string;
}
