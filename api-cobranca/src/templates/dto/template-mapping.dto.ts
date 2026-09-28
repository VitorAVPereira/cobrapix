import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Max,
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
