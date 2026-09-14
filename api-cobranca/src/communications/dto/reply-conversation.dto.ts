import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class ReplyConversationDto {
  @IsUUID()
  idempotencyId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content!: string;
}
