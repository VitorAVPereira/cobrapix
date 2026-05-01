import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';
import { TEMPLATE_SLUGS } from '../template-catalog';

const META_TEMPLATE_CATEGORIES = ['UTILITY', 'MARKETING', 'AUTHENTICATION'];

export class UpdateTemplateDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  @IsIn(TEMPLATE_SLUGS)
  slug?: string;

  @IsString()
  @IsOptional()
  @MaxLength(4000)
  content?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(512)
  @Matches(/^[a-z0-9_]+$/)
  metaTemplateName?: string;

  @IsString()
  @IsOptional()
  @Matches(/^[a-z]{2}_[A-Z]{2}$/)
  metaLanguage?: string;

  @IsString()
  @IsOptional()
  @IsIn(META_TEMPLATE_CATEGORIES)
  category?: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
}
