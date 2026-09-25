import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { MessageContextDto } from './message-context.dto';

export class ReplyConversationDto {
  @IsUUID()
  idempotencyId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content!: string;

  /** WhatsApp only. Without it the reply stays internal to the platform team. */
  @IsOptional()
  @ValidateNested()
  @Type(() => MessageContextDto)
  context?: MessageContextDto;

  /** Message of this conversation to quote. WhatsApp only. */
  @IsOptional()
  @IsUUID()
  replyToMessageId?: string;
}
