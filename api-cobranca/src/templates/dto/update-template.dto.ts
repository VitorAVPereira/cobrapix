import { IsString, IsOptional, MaxLength, IsBoolean } from 'class-validator';

export class UpdateTemplateDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  slug?: string;

  @IsString()
  @IsOptional()
  @MaxLength(4000)
  content?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}