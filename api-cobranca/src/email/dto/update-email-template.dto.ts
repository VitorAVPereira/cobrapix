import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { TEMPLATE_SLUGS } from '../email-template-catalog';

export class UpdateEmailTemplateDto {
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
  @MaxLength(160)
  subject?: string;

  @IsString()
  @IsOptional()
  @MaxLength(4000)
  content?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
