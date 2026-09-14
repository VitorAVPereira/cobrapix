import { Type } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class OnboardingAddressDto {
  @IsOptional() @Matches(/^\d{8}$/) postalCode?: string;
  @IsOptional() @IsString() @Length(2, 160) street?: string;
  @IsOptional() @IsString() @Length(1, 20) number?: string;
  @IsOptional() @IsString() @Length(2, 100) district?: string;
  @IsOptional() @IsString() @Length(2, 100) city?: string;
  @IsOptional()
  @Matches(
    /^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/,
  )
  state?: string;
}

export class OnboardingRepresentativeDto {
  @IsOptional() @IsString() @Length(3, 160) name?: string;
  @IsOptional() @Matches(/^\d{11}$/) cpf?: string;
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  birthDate?: string;
  @IsOptional() @IsString() @Length(3, 160) motherName?: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @Matches(/^(55)?\d{10,11}$/) phone?: string;
}

export class OnboardingConsentDto {
  @Equals(true) authorized!: boolean;
  @Equals(true) termsAccepted!: boolean;
  @Equals(true) privacyAccepted!: boolean;
  @IsString() @Length(1, 64) authorizationVersion!: string;
  @IsString() @Length(1, 64) termsVersion!: string;
  @IsString() @Length(1, 64) privacyVersion!: string;
}

export class OnboardingDraftDto {
  @IsOptional() @IsInt() @Min(0) revision?: number;
  @IsOptional() @IsString() @Length(2, 160) corporateName?: string;
  @IsOptional() @IsString() @Length(2, 160) tradeName?: string;
  @IsOptional() @Matches(/^\d{14}$/) document?: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => OnboardingAddressDto)
  address?: OnboardingAddressDto;
  @IsOptional()
  @ValidateNested()
  @Type(() => OnboardingRepresentativeDto)
  representative?: OnboardingRepresentativeDto;
  @IsOptional()
  @ValidateNested()
  @Type(() => OnboardingConsentDto)
  consent?: OnboardingConsentDto;
}
