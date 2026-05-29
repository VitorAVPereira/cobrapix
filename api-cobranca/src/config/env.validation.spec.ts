import { validateEnv } from './env.validation';

function buildValidConfig(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return Object.assign(
    {
      NODE_ENV: 'development',
      PORT: '3001',
      DATABASE_URL: 'postgresql://user:password@localhost:5432/cobrapix',
      JWT_SECRET: 'jwt_secret_with_at_least_32_characters',
      FRONTEND_URL: 'http://localhost:3000',
      EFI_ENV: 'homologation',
      EFI_WEBHOOK_SECRET: 'efi_webhook_secret_with_32_characters',
    },
    overrides,
  );
}

describe('validateEnv', () => {
  it('exige RESEND_WEBHOOK_SECRET em producao', () => {
    expect(() =>
      validateEnv(
        buildValidConfig({
          NODE_ENV: 'production',
          RESEND_WEBHOOK_SECRET: undefined,
        }),
      ),
    ).toThrow('RESEND_WEBHOOK_SECRET e obrigatoria em producao');
  });

  it('aceita RESEND_WEBHOOK_SECRET com prefixo whsec', () => {
    const env = validateEnv(
      buildValidConfig({
        NODE_ENV: 'production',
        RESEND_WEBHOOK_SECRET: 'whsec_test_secret',
      }),
    );

    expect(env.RESEND_WEBHOOK_SECRET).toBe('whsec_test_secret');
  });

  it('rejeita RESEND_WEBHOOK_SECRET com formato inesperado', () => {
    expect(() =>
      validateEnv(
        buildValidConfig({
          RESEND_WEBHOOK_SECRET: 'plain-secret',
        }),
      ),
    ).toThrow('RESEND_WEBHOOK_SECRET deve comecar com whsec_');
  });
});
