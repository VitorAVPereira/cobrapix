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
      FRONTEND_URL: 'https://app.cobrapix.test',
      EFI_ENV: 'homologation',
      EFI_WEBHOOK_SECRET: 'efi_webhook_secret_with_32_characters',
      AUTH_RESEND_API_KEY: 're_test_platform_key',
      AUTH_EMAIL_FROM: 'CobraPix <acesso@cobrapix.test>',
    },
    overrides,
  );
}

describe('validateEnv', () => {
  it('permite producao sem RESEND_WEBHOOK_SECRET global quando webhooks usam secret por cliente', () => {
    const env = validateEnv(
      buildValidConfig({
        NODE_ENV: 'production',
        RESEND_WEBHOOK_SECRET: undefined,
      }),
    );

    expect(env.RESEND_WEBHOOK_SECRET).toBeUndefined();
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

  it('rejeita produção sem configuração de e-mail de recuperação', () => {
    expect(() =>
      validateEnv(
        buildValidConfig({
          NODE_ENV: 'production',
          AUTH_RESEND_API_KEY: undefined,
          AUTH_EMAIL_FROM: undefined,
        }),
      ),
    ).toThrow('AUTH_RESEND_API_KEY é obrigatória em produção');
  });

  it('rejeita FRONTEND_URL sem HTTPS em produção', () => {
    expect(() =>
      validateEnv(
        buildValidConfig({
          NODE_ENV: 'production',
          FRONTEND_URL: 'http://app.cobrapix.test',
        }),
      ),
    ).toThrow('FRONTEND_URL deve usar HTTPS em produção');
  });

  it('permite FRONTEND_URL local com HTTP em desenvolvimento', () => {
    const env = validateEnv(
      buildValidConfig({
        NODE_ENV: 'development',
        FRONTEND_URL: 'http://localhost:3000',
      }),
    );

    expect(env.FRONTEND_URL).toBe('http://localhost:3000');
  });

  it('rejeita remetente de autenticação sem endereço de e-mail válido', () => {
    expect(() =>
      validateEnv(
        buildValidConfig({
          AUTH_EMAIL_FROM: 'remetente-invalido',
        }),
      ),
    ).toThrow('AUTH_EMAIL_FROM deve conter um e-mail válido');
  });

  it('rejeita quantidade negativa de proxies confiáveis', () => {
    expect(() =>
      validateEnv(buildValidConfig({ TRUST_PROXY_HOPS: -1 })),
    ).toThrow('TRUST_PROXY_HOPS');
  });
});
