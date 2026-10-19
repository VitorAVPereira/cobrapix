import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  ValidateNested,
} from 'class-validator';
import { DisbursementBatchStatus } from '@prisma/client';

const toInt = ({ value }: { value: string }): number => Number(value);

export class DisbursementBatchItemDto {
  @IsUUID() recipientId!: string;
  @IsInt() @Min(1) @Max(2147483647) amountCents!: number;
}

const DATE = /^d{4}-d{2}-d{2}$/;

/** Repeat every N days, weeks or months; ends on a date, after N times, or never. */
export class DisbursementRepeatDto {
  @IsIn(['DAY', 'WEEK', 'MONTH']) unit!: 'DAY' | 'WEEK' | 'MONTH';
  @IsInt() @Min(1) @Max(366) every!: number;
  @IsOptional() @Matches(DATE) endsOn?: string;
  @IsOptional() @IsInt() @Min(2) @Max(500) occurrences?: number;
}

export class CreateDisbursementBatchDto {
  @IsString() @Length(2, 80) reference!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => DisbursementBatchItemDto)
  items!: DisbursementBatchItemDto[];
  /** Today requests the approval right away; a later date schedules it for 08:00. */
  @IsOptional() @Matches(DATE) scheduledFor?: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => DisbursementRepeatDto)
  repeat?: DisbursementRepeatDto;
}

export class UpdateDisbursementBatchDto extends CreateDisbursementBatchDto {
  @IsInt() @Min(1) expectedVersion!: number;
  /** Also use these collaborators and amounts in the next repetitions. */
  @IsOptional() @IsBoolean() applyToSchedule?: boolean;
}

export class ScheduleDisbursementBatchDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @Matches(DATE) scheduledFor!: string;
}

export class EndDisbursementScheduleDto {
  @IsInt() @Min(1) expectedVersion!: number;
}

export class RequestDisbursementApprovalDto {
  @IsInt() @Min(1) expectedVersion!: number;
}

export class DisbursementBatchesQueryDto {
  @IsOptional()
  @IsIn(Object.values(DisbursementBatchStatus))
  status?: DisbursementBatchStatus;
  @IsOptional() @Transform(toInt) @IsInt() @Min(1) page = 1;
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
