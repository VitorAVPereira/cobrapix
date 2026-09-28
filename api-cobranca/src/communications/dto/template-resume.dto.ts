import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { TEMPLATE_BLOCK_CODES } from '../../templates/template-contracts';

export class TemplatePendingQueryDto {
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsUUID()
  templateId?: string;

  @IsOptional()
  @IsIn(TEMPLATE_BLOCK_CODES)
  code?: string;

  @IsOptional()
  @IsIn(['BLOCKED', 'RESUMED', 'CLOSED'])
  state?: 'BLOCKED' | 'RESUMED' | 'CLOSED';

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
}

/** Company listing: the company comes from the session, never from the query. */
export class CompanyTemplatePendingQueryDto {
  @IsOptional()
  @IsIn(['BLOCKED', 'RESUMED', 'CLOSED'])
  state?: 'BLOCKED' | 'RESUMED' | 'CLOSED';

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
}

export class ResumeItemDto {
  @IsUUID()
  pendingId!: string;

  @IsOptional()
  @IsUUID()
  replacementTemplateId?: string;
}

export class ResumePreviewDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ResumeItemDto)
  items!: ResumeItemDto[];
}

export class ConfirmResumeDto {
  @IsUUID()
  idempotencyId!: string;
}
