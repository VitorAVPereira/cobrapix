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
      DATAFY_API_TOKEN: 'sk_live_test_only',
      DATAFY_WEBHOOK_SECRET: 'whsec_test_only',
      DATAFY_WEBHOOK_BASE_URL: 'https://api.example.test/webhooks/datafy',
      META_PHONE_NUMBER_ID: '123456789',
      META_BUSINESS_ACCOUNT_ID: '123456780',
      RESEND_API_KEY: 're_test',
      RESEND_FROM_EMAIL: 'CifraMais <cobranca@example.test>',
      RESEND_REPLY_TO: 'suporte@example.test',
      RESEND_WEBHOOK_SECRET: 'whsec_test',
      EFI_OPENING_CLIENT_ID: 'opening-client',
      EFI_OPENING_CLIENT_SECRET: 'opening-secret',
      EFI_OPENING_CERT_PATH: '/run/secrets/efi-integrator.p12',
      EFI_PLATFORM_CLIENT_ID: 'platform-client',
      EFI_PLATFORM_CLIENT_SECRET: 'platform-secret',
      EFI_PLATFORM_CERT_PATH: '/run/secrets/efi-platform.p12',
      EFI_PLATFORM_PAYEE_CODE: 'payee-code',
      EFI_PLATFORM_ACCOUNT_NUMBER: '12345',
      EFI_PLATFORM_CNPJ: '12345678000190',
      EFI_WEBHOOK_BASE_URL: 'https://efi.example.test',
      EFI_CHARGES_WEBHOOK_BASE_URL: 'https://api.example.test',
      PAYMENT_ENCRYPTION_KEYS: JSON.stringify({ v1: '11'.repeat(32) }),
      PAYMENT_ACTIVE_KEY_VERSION: 'v1',
    },
    overrides,
  );
}

describe('validateEnv', () => {
  it('aceita armazenamento de anexos opcional com caminho absoluto e limite positivo', () => {
    const env = validateEnv(
      buildValidConfig({
        COMMUNICATION_MEDIA_DIR: '/var/lib/ciframais/communication-media',
        COMMUNICATION_MEDIA_LIMIT_BYTES: '5368709120',
      }),
    );
    expect(env.COMMUNICATION_MEDIA_LIMIT_BYTES).toBe(5368709120);
    expect(
      validateEnv(
        buildValidConfig({
          COMMUNICATION_MEDIA_DIR: '',
          COMMUNICATION_MEDIA_LIMIT_BYTES: '',
        }),
      ).COMMUNICATION_MEDIA_DIR,
    ).toBeUndefined();
    expect(() =>
      validateEnv(buildValidConfig({ COMMUNICATION_MEDIA_DIR: 'media' })),
    ).toThrow(/caminho absoluto/);
    expect(() =>
      validateEnv(buildValidConfig({ COMMUNICATION_MEDIA_LIMIT_BYTES: '-1' })),
    ).toThrow();
  });

  it('usa somente Datafy e descarta variaveis antigas da Meta direta', () => {
    const env = validateEnv(
      buildValidConfig({
        NODE_ENV: 'production',
        WHATSAPP_TRANSPORT: 'META_DIRECT',
        META_ACCESS_TOKEN: 'legacy-token',
        META_APP_SECRET: 'legacy-secret',
      }),
    ) as Record<string, unknown>;
    expect(env.DATAFY_API_TOKEN).toBe('sk_live_test_only');
    for (const key of [
      'WHATSAPP_TRANSPORT',
      'META_ACCESS_TOKEN',
      'META_APP_SECRET',
    ])
      expect(env[key]).toBeUndefined();
  });

  it('aceita segredo anterior do webhook somente durante rotacao valida', () => {
    expect(
      validateEnv(
        buildValidConfig({
          DATAFY_WEBHOOK_SECRET: 'whsec_new',
          DATAFY_WEBHOOK_SECRET_PREVIOUS: 'whsec_old',
        }),
      ).DATAFY_WEBHOOK_SECRET_PREVIOUS,
    ).toBe('whsec_old');
    for (const previous of ['old-format', 'whsec_new'])
      expect(() =>
        validateEnv(
          buildValidConfig({
            DATAFY_WEBHOOK_SECRET: 'whsec_new',
            DATAFY_WEBHOOK_SECRET_PREVIOUS: previous,
          }),
        ),
      ).toThrow('DATAFY_WEBHOOK_SECRET_PREVIOUS');
  });

  it.each([
    'DATAFY_API_TOKEN',
    'DATAFY_WEBHOOK_SECRET',
    'DATAFY_WEBHOOK_BASE_URL',
    'META_PHONE_NUMBER_ID',
    'META_BUSINESS_ACCOUNT_ID',
  ])('exige %s em producao', (field: string) => {
    expect(() =>
      validateEnv(buildValidConfig({ NODE_ENV: 'production', [field]: '' })),
    ).toThrow(field);
  });

  it('permite desenvolvimento sem canal WhatsApp configurado', () => {
    expect(() =>
      validateEnv(
        buildValidConfig({
          DATAFY_API_TOKEN: '',
          DATAFY_WEBHOOK_SECRET: '',
          DATAFY_WEBHOOK_BASE_URL: '',
          META_PHONE_NUMBER_ID: undefined,
          META_BUSINESS_ACCOUNT_ID: undefined,
        }),
      ),
    ).not.toThrow();
  });

  it.each([
    ['DATAFY_API_TOKEN', 'token-sem-prefixo'],
    ['DATAFY_WEBHOOK_SECRET', 'segredo-sem-prefixo'],
    ['META_PHONE_NUMBER_ID', 'abc'],
  ])('valida o formato de %s', (field: string, value: string) => {
    expect(() => validateEnv(buildValidConfig({ [field]: value }))).toThrow(
      field,
    );
  });

  it.each([
    'http://api.example.test/webhooks/datafy',
    'https://localhost/webhooks/datafy',
    'https://127.0.0.1/webhooks/datafy',
    'https://user:pass@api.example.test/webhooks/datafy',
  ])('recusa webhook Datafy nao publico em producao: %s', (url: string) => {
    expect(() =>
      validateEnv(
        buildValidConfig({
          NODE_ENV: 'production',
          DATAFY_WEBHOOK_BASE_URL: url,
        }),
      ),
    ).toThrow('DATAFY_WEBHOOK_BASE_URL');
  });

  it('exige assinatura Resend central em produção', () => {
    expect(() =>
      validateEnv(
        buildValidConfig({
          NODE_ENV: 'production',
          RESEND_WEBHOOK_SECRET: undefined,
        }),
      ),
    ).toThrow('RESEND_WEBHOOK_SECRET');
  });

  it.each([
    'DATAFY_API_TOKEN',
    'EFI_OPENING_CLIENT_SECRET',
    'EFI_OPENING_CERT_PATH',
    'EFI_PLATFORM_CNPJ',
    'EFI_PLATFORM_PAYEE_CODE',
    'EFI_PLATFORM_ACCOUNT_NUMBER',
    'PAYMENT_ENCRYPTION_KEYS',
    'RESEND_REPLY_TO',
  ])('exige %s em produção', (field: string) => {
    expect(() =>
      validateEnv(
        buildValidConfig({ NODE_ENV: 'production', [field]: undefined }),
      ),
    ).toThrow(field);
  });

  it('trata como ausentes os opcionais deixados em branco no api.env', () => {
    expect(() =>
      validateEnv(
        buildValidConfig({
          NODE_ENV: 'production',
          EFI_OPENING_ENABLED: 'false',
          EFI_OPENING_CLIENT_ID: '',
          EFI_OPENING_CLIENT_SECRET: ' ',
          EFI_OPENING_CERT_PATH: '',
          EFI_PLATFORM_CLIENT_ID: '',
          PLATFORM_ALERT_EMAIL: '',
        }),
      ),
    ).not.toThrow();
    expect(() =>
      validateEnv(
        buildValidConfig({ NODE_ENV: 'production', EFI_PLATFORM_CNPJ: '' }),
      ),
    ).toThrow('EFI_PLATFORM_CNPJ');
  });

  it('não exige credenciais de API da conta CifraMais (sem uso na conta do cliente)', () => {
    expect(() =>
      validateEnv(
        buildValidConfig({
          NODE_ENV: 'production',
          EFI_PLATFORM_CLIENT_ID: undefined,
          EFI_PLATFORM_CLIENT_SECRET: undefined,
          EFI_PLATFORM_CERT_PATH: undefined,
        }),
      ),
    ).not.toThrow();
  });

  it('dispensa as credenciais de abertura quando EFI_OPENING_ENABLED=false', () => {
    expect(() =>
      validateEnv(
        buildValidConfig({
          NODE_ENV: 'production',
          EFI_OPENING_ENABLED: 'false',
          EFI_OPENING_CLIENT_ID: undefined,
          EFI_OPENING_CLIENT_SECRET: undefined,
          EFI_OPENING_CERT_PATH: undefined,
        }),
      ),
    ).not.toThrow();
    expect(() =>
      validateEnv(
        buildValidConfig({
          NODE_ENV: 'production',
          EFI_OPENING_CLIENT_ID: undefined,
        }),
      ),
    ).toThrow('EFI_OPENING_CLIENT_ID');
    expect(() =>
      validateEnv(buildValidConfig({ EFI_OPENING_ENABLED: 'no' })),
    ).toThrow('EFI_OPENING_ENABLED');
  });

  it('rejeita mapa criptográfico inválido sem revelar a chave', () => {
    expect(() =>
      validateEnv(
        buildValidConfig({ PAYMENT_ENCRYPTION_KEYS: '{"v1":"short-secret"}' }),
      ),
    ).toThrow('PAYMENT_ENCRYPTION_KEYS');
  });

  it('exige HTTPS no hostname dedicado Efí em produção', () => {
    expect(() =>
      validateEnv(
        buildValidConfig({
          NODE_ENV: 'production',
          EFI_WEBHOOK_BASE_URL: 'http://efi.example.test',
        }),
      ),
    ).toThrow('EFI_WEBHOOK_BASE_URL');
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
