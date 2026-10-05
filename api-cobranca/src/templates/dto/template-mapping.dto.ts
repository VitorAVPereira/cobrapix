import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ToBoolean } from '../../common/to-boolean';
import type { TemplateMapping } from '../template-contracts';

/** The map itself is checked by validateMapping: closed sources, no unknown keys. */
export class SaveTemplateMappingDto {
  @IsInt()
  @Min(0)
  expectedProviderRevision!: number;

  @IsInt()
  @Min(0)
  expectedMappingRevision!: number;

  @IsObject()
  mapping!: TemplateMapping;
}

export class PreviewTemplateMappingDto {
  @IsObject()
  mapping!: TemplateMapping;
}

export class CatalogPageQueryDto {
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;

  /** Part of the template name, case-insensitive. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class AdminCatalogQueryDto extends CatalogPageQueryDto {
  @IsOptional()
  @IsIn(['APPROVED', 'UNAVAILABLE', 'ALL'])
  status?: 'APPROVED' | 'UNAVAILABLE' | 'ALL';

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  supported?: boolean;
}
