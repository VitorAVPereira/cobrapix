import { IsOptional, IsUUID, ValidateIf } from 'class-validator';

/** Company context of a message. `companyId: null` explicitly means no company (admin only). */
export class MessageContextDto {
  @ValidateIf((value: MessageContextDto) => value.companyId !== null)
  @IsUUID()
  companyId!: string | null;

  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @IsOptional()
  @IsUUID()
  debtorId?: string;
}
