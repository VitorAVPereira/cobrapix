import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { MessageContextDto } from './message-context.dto';

export class TemplateReplyDto {
  @IsUUID()
  idempotencyId!: string;

  @IsUUID()
  templateId!: string;

  /** Positional values, in the order the variables appear in the approved template. */
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(1024, { each: true })
  parameters!: string[];

  /** Required when the template has a payment button: the link is built for this invoice. */
  @IsOptional()
  @ValidateNested()
  @Type(() => MessageContextDto)
  context?: MessageContextDto;
}
