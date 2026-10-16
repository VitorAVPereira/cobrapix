import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
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

export class CreateDisbursementBatchDto {
  @IsString() @Length(2, 80) reference!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => DisbursementBatchItemDto)
  items!: DisbursementBatchItemDto[];
}

export class UpdateDisbursementBatchDto extends CreateDisbursementBatchDto {
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
