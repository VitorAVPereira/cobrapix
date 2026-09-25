import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { TEMPLATE_SLUGS } from '../email-template-catalog';
import { ToBoolean } from '../../common/to-boolean';

export class CreateEmailTemplateDto {
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
  @MaxLength(160)
  subject!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content!: string;

  @ToBoolean()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
