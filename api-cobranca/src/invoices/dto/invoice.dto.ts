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
  @Matches(/^\+?[\d\s().-]{10,24}$/)
  phone_number?: string;

  @ValidateIf((dto: CreateInvoiceDto) => !dto.debtorId)
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsBoolean()
  whatsappOptIn?: boolean;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999999.99)
  original_amount!: number;

  @ValidateIf((dto: CreateInvoiceDto) => dto.recurring !== true)
  @IsString()
  due_date?: string;

  @IsIn(['PIX', 'BOLETO', 'BOLIX'])
  billing_type!: BillingType;

  @IsOptional()
  @IsBoolean()
  recurring?: boolean;

  @ValidateIf((dto: CreateInvoiceDto) => dto.recurring === true)
  @IsInt()
  @Min(1)
  @Max(31)
  due_day?: number;
}

export class CreateDebtorInvoiceDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999999.99)
  original_amount!: number;

  @ValidateIf((dto: CreateDebtorInvoiceDto) => dto.recurring !== true)
  @IsString()
  due_date?: string;

  @IsIn(['PIX', 'BOLETO', 'BOLIX'])
  billing_type!: BillingType;

  @IsOptional()
  @IsBoolean()
  recurring?: boolean;

  @ValidateIf((dto: CreateDebtorInvoiceDto) => dto.recurring === true)
  @IsInt()
  @Min(1)
  @Max(31)
  due_day?: number;
}

export class UpdateRecurringInvoiceDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999999.99)
  amount!: number;

  @IsIn(['PIX', 'BOLETO', 'BOLIX'])
  billingType!: BillingType;

  @IsInt()
  @Min(1)
  @Max(31)
  dueDay!: number;
}

export class UpdateDebtorSettingsDto {
  @IsOptional()
  @IsBoolean()
  useGlobalBillingSettings?: boolean;

  @IsOptional()
  @IsBoolean()
  whatsappOptIn?: boolean;

  @IsOptional()
  @IsIn(['PIX', 'BOLETO', 'BOLIX'])
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
  @IsBoolean()
  autoGenerateFirstCharge?: boolean;

  @IsOptional()
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
  collectionProfileId?: string | null;
}
