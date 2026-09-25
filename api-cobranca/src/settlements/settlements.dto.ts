import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
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
import { ToBoolean } from '../common/to-boolean';

export const SETTLEMENT_STATUSES = [
  'AWAITING_EVIDENCE',
  'RECONCILED',
  'DIVERGENT',
] as const;

// Statement entry (or set of entries) where CifraMais saw its split fees.
export class RecordPlatformFeeEvidenceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  settlementIds!: string[];

  @IsString()
  @Length(1, 128)
  reference!: string;

  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  receivedAmountCents!: number;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}

export const DIVERGENCE_DECISIONS = [
  'ACCEPT_AS_SETTLEMENT',
  'ISSUE_COMPLEMENTARY',
  'REFUND_REGISTERED',
  'KEEP_AS_CREDIT',
  'ACCEPT_DIFFERENCE',
  'ADJUSTMENT_SETTLED',
  'REVERSAL_PAID',
  'REVERSAL_WAIVED',
] as const;
export type DivergenceDecision = (typeof DIVERGENCE_DECISIONS)[number];

export class ResolveDivergenceDto {
  @IsIn(DIVERGENCE_DECISIONS)
  decision!: DivergenceDecision;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  reference?: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;

  // Due date of the complementary invoice (ISSUE_COMPLEMENTARY).
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dueDate?: string;
}

export class SettlementOptionsDto {
  @ToBoolean()
  @IsBoolean()
  refundPlatformFeeOnRefund!: boolean;
}
