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
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

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

  /** Debtor name, phone, document or e-mail, only among the session company's debtors. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;
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

  /** Debtor name, phone, document or e-mail; with companyId, only that company's debtors. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(ConversationStatus)
  status?: ConversationStatus;

  /** Conversations with inbound messages not attributed to any company. */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  pendingClassification?: boolean;
}
