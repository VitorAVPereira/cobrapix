import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ConversationStatus } from '@prisma/client';
import { CommunicationsQueryDto } from './communications-query.dto';
import { ToBoolean } from '../../common/to-boolean';

const toInt = ({ value }: { value: string }): number => Number(value);

/** Company projection. The company always comes from the session, never from the query. */
export class CompanyConversationsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  cursor?: string;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;

  @IsOptional()
  @IsIn(['WHATSAPP', 'EMAIL'])
  channel?: 'WHATSAPP' | 'EMAIL';
}

export class ConversationMessagesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  cursor?: string;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
}

export class AdminConversationMessagesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  cursor?: string;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}

export class AdminConversationsQueryDto extends CommunicationsQueryDto {
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @IsOptional()
  @IsEnum(ConversationStatus)
  status?: ConversationStatus;

  /** Conversations with inbound messages not attributed to any company. */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  pendingClassification?: boolean;
}
