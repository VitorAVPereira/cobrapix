import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ToBoolean } from '../../common/to-boolean';

const toInt = ({ value }: { value: string }): number => Number(value);

// Formats are checked by normalizeRecipient, which also reports import errors per row.
export class DisbursementRecipientDto {
  @IsString() @MaxLength(200) name!: string;
  @IsString() @MaxLength(30) document!: string;
  @IsOptional() @IsString() @MaxLength(120) pixKey?: string | null;
  @IsOptional() @IsString() @MaxLength(20) bankIspb?: string | null;
  @IsOptional() @IsString() @MaxLength(20) bankAgency?: string | null;
  @IsOptional() @IsString() @MaxLength(30) bankAccount?: string | null;
  @IsOptional() @IsString() @MaxLength(10) bankAccountType?: string | null;
}

export class UpdateDisbursementRecipientDto extends DisbursementRecipientDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsBoolean() active!: boolean;
}

export class ImportDisbursementRecipientsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => DisbursementRecipientDto)
  rows!: DisbursementRecipientDto[];
}

export class DisbursementRecipientsQueryDto {
  /** Name or document, only among the session company's collaborators. */
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @ToBoolean() @IsBoolean() includeInactive?: boolean;
  @IsOptional() @Transform(toInt) @IsInt() @Min(1) page = 1;
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
