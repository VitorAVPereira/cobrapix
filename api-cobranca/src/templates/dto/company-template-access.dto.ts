import { IsBoolean, IsInt, IsUUID, Min, ValidateIf } from 'class-validator';

export class SetTemplateGrantDto {
  @IsBoolean()
  enabled!: boolean;

  /** 0 when the company has no record for this template yet. */
  @IsInt()
  @Min(0)
  expectedVersion!: number;
}

export class SetTemplateDefaultDto {
  /** null clears the purpose default. */
  @ValidateIf((value: SetTemplateDefaultDto) => value.templateId !== null)
  @IsUUID()
  templateId!: string | null;

  @IsInt()
  @Min(0)
  expectedVersion!: number;
}

export class SetCollectionStepTemplateDto {
  /** null removes the custom template: the step uses the global one again. */
  @ValidateIf(
    (value: SetCollectionStepTemplateDto) => value.templateId !== null,
  )
  @IsUUID()
  templateId!: string | null;
}
