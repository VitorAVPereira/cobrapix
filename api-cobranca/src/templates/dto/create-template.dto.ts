import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';
import { TEMPLATE_SLUGS } from '../template-catalog';

const META_TEMPLATE_CATEGORIES = ['UTILITY', 'MARKETING', 'AUTHENTICATION'];

export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @IsIn(TEMPLATE_SLUGS)
  slug!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content!: string;

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
