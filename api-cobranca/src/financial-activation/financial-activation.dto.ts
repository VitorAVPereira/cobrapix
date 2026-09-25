import {
  Equals,
  IsBoolean,
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  ACCOUNT_MODES,
  FINANCIAL_ISSUANCE_METHODS,
  PAYOUT_MODES,
} from './financial-activation.types';
import type {
  AccountMode,
  FinancialIssuanceMethod,
  PayoutMode,
} from './financial-activation.types';
import { ToBoolean } from '../common/to-boolean';

export const EFI_ENVIRONMENTS = ['HOMOLOGATION', 'PRODUCTION'] as const;
export type EfiEnvironmentValue = (typeof EFI_ENVIRONMENTS)[number];

export class CreateFinancialActivationDto {
  @IsUUID('4') idempotencyKey!: string;
  @IsIn(ACCOUNT_MODES) accountMode!: AccountMode;
  @IsIn(PAYOUT_MODES) payoutMode!: PayoutMode;
  @IsIn(EFI_ENVIRONMENTS) environment!: EfiEnvironmentValue;
  @ArrayMinSize(1)
  @ArrayMaxSize(FINANCIAL_ISSUANCE_METHODS.length)
  @ArrayUnique()
  @IsIn(FINANCIAL_ISSUANCE_METHODS, { each: true })
  enabledMethods!: FinancialIssuanceMethod[];
}

export class UpdateFinancialConfigurationDto {
  @Type(() => Number) @IsInt() @Min(1) expectedRevision!: number;
  @IsOptional()
  @ArrayMinSize(1)
  @ArrayMaxSize(FINANCIAL_ISSUANCE_METHODS.length)
  @ArrayUnique()
  @IsIn(FINANCIAL_ISSUANCE_METHODS, { each: true })
  enabledMethods?: FinancialIssuanceMethod[];
  // Contract or document that authorizes CifraMais to integrate the account.
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  authorizationReference?: string;
  @IsOptional() @IsDateString() authorizationValidUntil?: string;
  // The admin attests the account holder against the company document and
  // records where the evidence is kept (e.g. Efí portal screenshot ticket).
  @IsOptional()
  @Matches(/^(\d{11}|\d{14})$/)
  ownershipVerifiedDocument?: string;
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  ownershipEvidenceReference?: string;
}

// Multipart fields sent with the `.p12` file. Secrets are write-only.
export class UploadFinancialCredentialsDto {
  @Type(() => Number) @IsInt() @Min(1) expectedRevision!: number;
  @IsString() @Matches(/^[\x21-\x7e]{1,256}$/) clientId!: string;
  @IsString() @Matches(/^[\x21-\x7e]{1,256}$/) clientSecret!: string;
  @IsOptional() @IsString() @MaxLength(256) certificatePassword?: string;
  @Matches(/^(\d{11}|\d{14})$/) holderDocument!: string;
  @Matches(/^\d{1,20}$/) efiAccountNumber!: string;
  @IsOptional() @Matches(/^[0-9Xx]{1,2}$/) efiAccountDigit?: string;
  @Matches(/^[A-Za-z0-9]{1,64}$/) payeeCode!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(77) pixKey?: string;
}

export class CancelFinancialActivationDto {
  @Type(() => Number) @IsInt() @Min(1) expectedRevision!: number;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class RequestFinancialValidationDto {
  @Type(() => Number) @IsInt() @Min(1) expectedRevision!: number;
  @IsUUID('4') idempotencyKey!: string;
}

export class ActivateFinancialProfileDto {
  @Type(() => Number) @IsInt() @Min(1) expectedRevision!: number;
  @IsUUID('4') validationAttemptId!: string;
  @IsUUID('4') idempotencyKey!: string;
  // The screen shows the effects (webhook, split, régua) before confirming.
  @ToBoolean() @Equals(true) confirmEffects!: true;
  @ToBoolean() @IsOptional() @IsBoolean() acknowledgeUnverifiedSteps?: boolean;
}

export class ManualActivationSwitchDto {
  @ToBoolean() @IsBoolean() enabled!: boolean;
}
