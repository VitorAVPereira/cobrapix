import {
  IsString,
  IsNumber,
  IsDateString,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class CreatePaymentDto {
  @IsUUID()
  invoiceId!: string;
}

export class PaymentCallbackDto {
  @IsString()
  event!: string;

  @IsString()
  payment!: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  pixQrCode?: string;

  @IsOptional()
  @IsString()
  pixCopyPaste?: string;

  @IsOptional()
  @IsNumber()
  value?: number;

  @IsOptional()
  @IsDateString()
  dateCreated?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  customer?: string;

  @IsOptional()
  @IsString()
  billingType?: string;
}
