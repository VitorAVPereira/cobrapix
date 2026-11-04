import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class CheckoutOfferQueryDto {
  // The seller's page links a specific offer: /c/oferta/<token>?oferta=<id>.
  @IsOptional() @IsUUID() oferta?: string;
}

export class CheckoutOfferChoiceDto {
  @IsUUID() offerId!: string;
}

export class CheckoutOfferAcceptDto extends CheckoutOfferChoiceDto {
  @IsIn(['PIX', 'CARD']) method!: 'PIX' | 'CARD';
  // Card: the quote and installments of the offer on the kept card.
  @ValidateIf((dto: CheckoutOfferAcceptDto) => dto.method === 'CARD')
  @IsUUID()
  quoteId?: string;
  @ValidateIf((dto: CheckoutOfferAcceptDto) => dto.method === 'CARD')
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  installments?: number;
  // A double click or a retried request gets the same order back.
  @IsUUID('4') idempotencyKey!: string;
}
