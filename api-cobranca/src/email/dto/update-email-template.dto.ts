import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateEmailTemplateDto {
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

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
