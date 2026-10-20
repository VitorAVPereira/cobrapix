import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';
import type {
  BillingMethod,
  TemplateRequestStatus,
  WhatsappTemplatePurpose,
} from '@prisma/client';
import {
  COLLECTION_PURPOSES,
  COLLECTION_SLOT_METHODS,
} from '../template-contracts';

export class CreateTemplateRequestDto {
  /** Step of the company's collection rule the template is for. */
  @IsOptional()
  @IsUUID()
  ruleStepId?: string;

  @IsOptional()
  @IsIn(COLLECTION_PURPOSES)
  purpose?: WhatsappTemplatePurpose;

  @IsOptional()
  @IsIn(COLLECTION_SLOT_METHODS)
  billingMethod?: BillingMethod;

  /** What the company wants the message to say. */
  @IsString()
  @Length(10, 1000)
  message!: string;
}

export class UpdateTemplateRequestDto {
  @IsIn(['OPEN', 'IN_PROGRESS', 'DONE', 'REJECTED'])
  status!: TemplateRequestStatus;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  adminNote?: string;

  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
