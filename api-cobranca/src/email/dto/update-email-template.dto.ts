import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateEmailTemplateDto {
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
