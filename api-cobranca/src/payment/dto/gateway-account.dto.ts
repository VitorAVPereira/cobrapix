import {
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class CreateGatewayAccountDto {
  @IsString()
  corporateName!: string;

  @IsString()
  cnpj!: string;

  @IsEmail()
  email!: string;

  @IsString()
  phoneNumber!: string;

  @IsString()
  legalRepresentative!: string;

  @IsString()
  legalRepresentativeCpf!: string;

  @IsDateString()
  legalRepresentativeBirthDate!: string;

  @IsString()
  postalCode!: string;

  @IsString()
  street!: string;

  @IsString()
  number!: string;

  @IsString()
  district!: string;

  @IsString()
  city!: string;

  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/)
  state!: string;

  @IsString()
  bankName!: string;

  @IsString()
  bankAgency!: string;

  @IsString()
  bankAccount!: string;

  @IsOptional()
  @IsString()
  bankAccountDigit?: string;

  @IsOptional()
  @IsIn(['CHECKING', 'SAVINGS'])
  bankAccountType?: 'CHECKING' | 'SAVINGS';

  @IsOptional()
  @IsIn(['homologation', 'production'])
  environment?: 'homologation' | 'production';

  @IsString()
  efiClientId!: string;

  @IsString()
  efiClientSecret!: string;

  @IsString()
  efiPayeeCode!: string;

  @IsString()
  efiAccountNumber!: string;

  @IsOptional()
  @IsString()
  efiAccountDigit?: string;

  @IsString()
  efiPixKey!: string;

  @IsOptional()
  @IsString()
  efiCertificatePath?: string;

  @IsOptional()
  @IsString()
  efiCertificatePassword?: string;

  @IsOptional()
  @IsString()
  efiCertificateBase64?: string;

  @IsOptional()
  @IsIn(['PENDING', 'ACTIVE', 'REJECTED', 'DISABLED'])
  gatewayStatus?: 'PENDING' | 'ACTIVE' | 'REJECTED' | 'DISABLED';
}

export interface GatewayAccountStatusResponse {
  provider: string;
  accountId: string | null;
  environment: string | null;
  status: string;
  hasApiKey: boolean;
  company: {
    corporateName: string;
    cnpj: string;
    email: string;
    phoneNumber: string;
  };
  legalRepresentative: {
    name: string | null;
    cpf: string | null;
    birthDate: string | null;
  };
  address: {
    postalCode: string | null;
    street: string | null;
    number: string | null;
    district: string | null;
    city: string | null;
    state: string | null;
  };
  bank: {
    name: string | null;
    agency: string | null;
    account: string | null;
    accountDigit: string | null;
    accountType: string | null;
    holderName: string | null;
    holderDocument: string | null;
  };
  efi: {
    payeeCode: string | null;
    accountNumber: string | null;
    accountDigit: string | null;
    pixKey: string | null;
    hasCertificate: boolean;
  };
}
