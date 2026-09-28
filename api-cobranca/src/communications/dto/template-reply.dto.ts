import { Type } from 'class-transformer';
import {
  IsDefined,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';

/** Templates always have a company; invoice and debtor are validated against the chat. */
export class TemplateReplyContextDto {
  @IsUUID()
  companyId!: string;

  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @IsOptional()
  @IsUUID()
  debtorId?: string;
}

/**
 * Parameters are never accepted from the browser: the server fills them from the
 * admin mapping and the selected context.
 */
export class TemplateReplyDto {
  @IsUUID()
  idempotencyId!: string;

  @IsUUID()
  templateId!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => TemplateReplyContextDto)
  context!: TemplateReplyContextDto;
}

export class TemplateOptionsQueryDto extends TemplateReplyContextDto {}
