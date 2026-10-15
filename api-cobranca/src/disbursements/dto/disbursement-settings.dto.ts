import {
  IsBoolean,
  IsInt,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';

export class DisbursementSettingsDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @IsBoolean() enabled!: boolean;
  @IsString() @Length(2, 80) approverName!: string;
  // Brazilian mobile with country code, digits only: the approver's WhatsApp.
  @Matches(/^55\d{10,11}$/, {
    message: 'Informe o celular com 55 e DDD, somente números.',
  })
  approverPhone!: string;
}
