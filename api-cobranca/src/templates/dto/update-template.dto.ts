import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { ToBoolean } from '../../common/to-boolean';

export class UpdateTemplateDto {
  @IsString()
  @IsOptional()
  @MaxLength(80)
  greeting?: string;

  @IsString()
  @IsOptional()
  @MaxLength(280)
  instructions?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  signature?: string;

  @ToBoolean()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
