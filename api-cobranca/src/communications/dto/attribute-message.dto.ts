import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MessageContextDto } from './message-context.dto';

export class AttributeMessageDto {
  /** Revision the admin saw; a concurrent correction returns 409. */
  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @ValidateNested()
  @Type(() => MessageContextDto)
  context!: MessageContextDto;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
