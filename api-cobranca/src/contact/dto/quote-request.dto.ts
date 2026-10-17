import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export class QuoteRequestDto {
  @IsString()
  @Length(2, 120, { message: 'Informe seu nome' })
  name!: string;

  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(254)
  email!: string;

  @IsString()
  @Matches(/^[\d\s()+-]{10,20}$/, { message: 'Celular inválido' })
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  monthlyVolume?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  averageTicket?: string;

  /** Honeypot: hidden from people, filled by bots. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}
