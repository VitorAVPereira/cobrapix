import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { IsBoolean, IsOptional } from 'class-validator';
import { EnabledDto } from '../efi-onboarding/onboarding-admin.controller';
import { ToBoolean } from './to-boolean';

class OptionalFlagDto {
  @IsOptional() @ToBoolean() @IsBoolean() flag?: boolean;
}

describe('ToBoolean', () => {
  // Same options as the global pipe in app.module.ts.
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });
  const parse = (metatype: new () => object, value: object) =>
    pipe.transform(value, { type: 'body', metatype });

  it.each([
    [true, true],
    [false, false],
    ['true', true],
    ['false', false],
  ])('converte %p em %p', async (input, expected) => {
    await expect(parse(EnabledDto, { enabled: input })).resolves.toEqual({
      enabled: expected,
    });
  });

  it.each(['', 'yes', 'FALSE', '0', 0, 1, null, {}])(
    'recusa %p em vez de tratá-lo como verdadeiro',
    async (input) => {
      await expect(
        parse(EnabledDto, { enabled: input }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('mantém campos opcionais ausentes', async () => {
    await expect(parse(OptionalFlagDto, {})).resolves.toEqual({});
  });
});
