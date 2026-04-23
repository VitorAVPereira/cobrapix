import { IsString, IsNotEmpty, IsOptional, MaxLength, IsBoolean } from 'class-validator';

export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  slug!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content!: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}