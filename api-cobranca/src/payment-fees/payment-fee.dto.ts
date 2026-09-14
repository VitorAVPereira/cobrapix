import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsInt,
  IsObject,
  IsPositive,
  IsUUID,
} from 'class-validator';
import { BillingMethod } from '@prisma/client';

export class PaymentFeeQueryDto {
  @IsEnum(BillingMethod)
  billingMethod!: BillingMethod;

  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt()
  @IsPositive()
  amountCents!: number;
}

export class CreatePaymentFeeVersionDto {
  @IsEnum(BillingMethod)
  billingMethod!: BillingMethod;

  @IsObject()
  efiFee!: Record<string, unknown>;

  @IsObject()
  platformFee!: Record<string, unknown>;

  @Type(() => Date)
  @IsDate()
  effectiveFrom!: Date;
}

export class CompanyIdParamDto {
  @IsUUID()
  companyId!: string;
}
