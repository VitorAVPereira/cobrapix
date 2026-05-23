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
const COPY_CODE_SOURCES = ['AUTO', 'PIX_COPY_PASTE', 'BOLETO_LINE_DIGITABLE'];

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

  @IsString()
  @IsOptional()
  @MaxLength(60)
  footerText?: string;

  @IsBoolean()
  @IsOptional()
  paymentButtonEnabled?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(25)
  paymentButtonLabel?: string;

  @IsBoolean()
  @IsOptional()
  copyCodeButtonEnabled?: boolean;

  @IsString()
  @IsOptional()
  @IsIn(COPY_CODE_SOURCES)
  copyCodeSource?: 'AUTO' | 'PIX_COPY_PASTE' | 'BOLETO_LINE_DIGITABLE';

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
