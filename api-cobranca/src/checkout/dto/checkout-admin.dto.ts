import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CheckoutCompanyDto {
  @IsString() @Length(2, 160) corporateName!: string;
  @IsString() @Length(11, 18) document!: string;
  @IsEmail() email!: string;
  @IsString() @Length(10, 24) phoneNumber!: string;
}

export class CheckoutFirstUserDto {
  @IsString() @Length(2, 120) name!: string;
  @IsEmail() email!: string;
}

export class CheckoutTermsDto {
  // 0 to 100% of each paid sale, in basis points.
  @IsInt() @Min(0) @Max(10_000) platformFeeBasisPoints!: number;
  @IsString() @Length(11, 18) payoutDocument!: string;
  @IsString() @Length(3, 77) payoutPixKey!: string;
}

export class CreateCheckoutClientDto {
  @ValidateNested()
  @Type(() => CheckoutCompanyDto)
  company!: CheckoutCompanyDto;
  @ValidateNested()
  @Type(() => CheckoutFirstUserDto)
  firstUser!: CheckoutFirstUserDto;
  @ValidateNested() @Type(() => CheckoutTermsDto) terms!: CheckoutTermsDto;
}

export class CardPauseDto {
  @IsBoolean() paused!: boolean;
  @IsString() @Length(5, 500) reason!: string;
}

export class UpdateCheckoutTermsDto extends CheckoutTermsDto {
  @IsInt() @Min(1) expectedVersion!: number;
}
