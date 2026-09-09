import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';

const STRONG_PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;
const STRONG_PASSWORD_MESSAGE =
  'A senha deve conter letra minúscula, letra maiúscula e número';

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @Length(10, 512)
  token!: string;

  @IsString()
  @Length(8, 120)
  @Matches(STRONG_PASSWORD_PATTERN, { message: STRONG_PASSWORD_MESSAGE })
  password!: string;

  @IsString()
  @Length(8, 120)
  passwordConfirmation!: string;
}

export class ChangePasswordDto {
  @IsString()
  @Length(6, 120)
  currentPassword!: string;

  @IsString()
  @Length(8, 120)
  @Matches(STRONG_PASSWORD_PATTERN, { message: STRONG_PASSWORD_MESSAGE })
  password!: string;

  @IsString()
  @Length(8, 120)
  passwordConfirmation!: string;
}
