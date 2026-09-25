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
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { ToBoolean } from '../../common/to-boolean';
import {
  LATE_FINE_MAX_PERCENTAGE,
  LATE_INTEREST_MONTHLY_MAX_PERCENTAGE,
  PAYMENT_DAYS_AFTER_DUE_MAX,
} from '../../invoices/late-terms';

export class UpdateBillingSettingsDto {
  @IsIn(['PIX', 'BOLIX'])
  preferredBillingMethod!: 'PIX' | 'BOLETO' | 'BOLIX';

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(-30, { each: true })
  @Max(365, { each: true })
  collectionReminderDays!: number[];

  @ToBoolean()
  @IsBoolean()
  autoGenerateFirstCharge!: boolean;

  @ToBoolean()
  @IsBoolean()
  autoDiscountEnabled!: boolean;

  @ValidateIf((dto: UpdateBillingSettingsDto) => dto.autoDiscountEnabled)
  @IsInt()
  @Min(0)
  @Max(365)
  autoDiscountDaysAfterDue?: number | null;

  @ValidateIf((dto: UpdateBillingSettingsDto) => dto.autoDiscountEnabled)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100)
  autoDiscountPercentage?: number | null;

  @IsOptional()
  @IsIn(['GENERAL', 'EDUCATION'])
  businessSegment?: 'GENERAL' | 'EDUCATION';

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  paymentNotificationEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsEmail({}, { each: true })
  paymentNotificationEmails?: string[];

  // Company defaults for new charges. Absent keeps the current value.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(LATE_FINE_MAX_PERCENTAGE)
  lateFinePercentage?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(LATE_INTEREST_MONTHLY_MAX_PERCENTAGE)
  lateInterestMonthlyPercentage?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PAYMENT_DAYS_AFTER_DUE_MAX)
  paymentDaysAfterDue?: number;
}
