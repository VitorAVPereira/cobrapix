import { z } from 'zod';
import { ConfigService } from '@nestjs/config';
import { isIP } from 'node:net';
import { PaymentCryptoService } from '../payment/payment-crypto.service';

function hasValidSenderEmail(value: string): boolean {
  const displayNameMatch = value.match(/^.+<([^<>]+)>$/);
  const email = (displayNameMatch?.[1] ?? value).trim();
  return z.string().email().safeParse(email).success;
}

const optionalSecret = z.preprocess(
  (value: unknown) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  z.string().min(1).optional(),
);

function isPublicHttpsWebhook(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (!url.port || url.port === '443') &&
      host.includes('.') &&
      !isIP(host) &&
      !/(^|\.)(localhost|local|internal|lan|localdomain)$/.test(host) &&
      url.pathname.replace(/\/$/, '') === '/webhooks/datafy'
    );
  } catch {
    return false;
  }
}

/**
 * Schema de validação das variáveis de ambiente do api-cobranca.
 *
 * Executado no bootstrap via `ConfigModule.forRoot({ validate: validateEnv })`.
 * Falha rápido com mensagem legível quando qualquer var obrigatória está ausente
 * ou fora do formato esperado.
 */
export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3001),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
    // WhatsApp goes exclusively through Datafy; there is no direct Meta integration.
    DATAFY_API_TOKEN: optionalSecret,
    DATAFY_WEBHOOK_SECRET: optionalSecret,
    /** Accepted alongside the current secret only while a rotation is in progress. */
    DATAFY_WEBHOOK_SECRET_PREVIOUS: optionalSecret,
    DATAFY_WEBHOOK_BASE_URL: z.preprocess(
      (value: unknown) =>
        typeof value === 'string' ? value.trim() || undefined : value,
      z.string().url().optional(),
    ),
    // Private attachment storage; absolute path outside the read-only image.
    COMMUNICATION_MEDIA_DIR: z.preprocess(
      (value: unknown) =>
        typeof value === 'string' ? value.trim() || undefined : value,
      z
        .string()
        .refine(
          (value) => value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value),
          {
            message: 'COMMUNICATION_MEDIA_DIR deve ser um caminho absoluto',
          },
        )
        .optional(),
    ),
    COMMUNICATION_MEDIA_LIMIT_BYTES: z.preprocess(
      (value: unknown) => (value === '' ? undefined : value),
      z.coerce.number().int().positive().optional(),
    ),
    // WABA identifiers, checked against Datafy /me (names kept from the Meta API).
    META_PHONE_NUMBER_ID: z.string().min(1).optional(),
    META_BUSINESS_ACCOUNT_ID: z.string().min(1).optional(),
    META_DEFAULT_LANGUAGE: z.string().default('pt_BR'),
    JWT_SECRET: z
      .string()
      .min(32, 'JWT_SECRET deve ter pelo menos 32 caracteres'),
    FRONTEND_URL: z.string().url().default('http://localhost:3000'),
    EFI_ENV: z.enum(['homologation', 'production']).default('homologation'),
    EFI_LEGAL_APPROVED: z.enum(['true', 'false']).default('false'),
    // Account-opening API (gn.registration.*). When false its credentials are
    // not required and manual financial activation is the only path.
    EFI_OPENING_ENABLED: z.enum(['true', 'false']).default('true'),
    EFI_OPENING_CLIENT_ID: z.string().min(1).optional(),
    EFI_OPENING_CLIENT_SECRET: z.string().min(1).optional(),
    EFI_OPENING_CERT_PATH: z.string().min(1).optional(),
    EFI_OPENING_CERT_PASSWORD: z.string().optional(),
    EFI_ONBOARDING_NOTICE_TEMPLATE: z.string().optional(),
    EFI_ONBOARDING_REMINDER_TEMPLATE: z.string().optional(),
    EFI_ONBOARDING_AUTHORIZATION_VERSION: z.string().default('draft-v1'),
    EFI_ONBOARDING_TERMS_VERSION: z.string().default('draft-v1'),
    EFI_ONBOARDING_PRIVACY_VERSION: z.string().default('draft-v1'),
    EFI_MTLS_PROXY_IP: z.string().optional(),
    PLATFORM_ALERT_EMAIL: z.string().email().optional(),
    EFI_PLATFORM_CLIENT_ID: z.string().optional(),
    EFI_PLATFORM_CLIENT_SECRET: z.string().optional(),
    EFI_PLATFORM_CERT_PATH: z.string().optional(),
    EFI_PLATFORM_CERT_PASSWORD: z.string().optional(),
    EFI_PLATFORM_PAYEE_CODE: z.string().optional(),
    EFI_PLATFORM_ACCOUNT_NUMBER: z.string().optional(),
    EFI_PLATFORM_CNPJ: z
      .string()
      .regex(/^\d{14}$/)
      .optional(),
    EFI_PLATFORM_SPLIT_PERCENTAGE: z.coerce
      .number()
      .int()
      .min(0)
      .max(10000)
      .default(0),
    EFI_WEBHOOK_BASE_URL: z.string().url().optional(),
    EFI_CHARGES_WEBHOOK_BASE_URL: z.string().url().optional(),
    EFI_WEBHOOK_SECRET: z
      .string()
      .min(32, 'EFI_WEBHOOK_SECRET deve ter pelo menos 32 caracteres'),
    PAYMENT_SECRET_KEY: z.string().min(32).optional(),
    PAYMENT_ENCRYPTION_KEYS: z.string().optional(),
    PAYMENT_ACTIVE_KEY_VERSION: z.string().optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
    RESEND_FROM_EMAIL: z.string().refine(hasValidSenderEmail).optional(),
    RESEND_REPLY_TO: z.string().email().optional(),
    AUTH_RESEND_API_KEY: z.string().min(1).optional(),
    AUTH_EMAIL_FROM: z
      .string()
      .refine(hasValidSenderEmail, {
        message: 'AUTH_EMAIL_FROM deve conter um e-mail válido',
      })
      .optional(),
    RESEND_WEBHOOK_SECRET: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const requiredInProduction = [
      'META_PHONE_NUMBER_ID',
      'META_BUSINESS_ACCOUNT_ID',
      'RESEND_API_KEY',
      'RESEND_FROM_EMAIL',
      'RESEND_REPLY_TO',
      'RESEND_WEBHOOK_SECRET',
      'EFI_CHARGES_WEBHOOK_BASE_URL',
      // CifraMais account that receives its fee through split. Its API
      // credentials (EFI_PLATFORM_CLIENT_*) are only needed by the CifraMais
      // account modes (Phase B) and are not required yet.
      'EFI_PLATFORM_PAYEE_CODE',
      'EFI_PLATFORM_ACCOUNT_NUMBER',
      'EFI_PLATFORM_CNPJ',
      'EFI_WEBHOOK_BASE_URL',
      'PAYMENT_ENCRYPTION_KEYS',
      'PAYMENT_ACTIVE_KEY_VERSION',
    ] as const;
    if (env.NODE_ENV === 'production' && env.EFI_OPENING_ENABLED === 'true') {
      for (const field of [
        'EFI_OPENING_CLIENT_ID',
        'EFI_OPENING_CLIENT_SECRET',
        'EFI_OPENING_CERT_PATH',
      ] as const) {
        if (!env[field])
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: `${field} é obrigatória em produção com EFI_OPENING_ENABLED=true`,
          });
      }
    }
    if (env.NODE_ENV === 'production') {
      for (const field of requiredInProduction) {
        if (!env[field])
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: `${field} é obrigatória em produção`,
          });
      }
      for (const field of [
        'EFI_WEBHOOK_BASE_URL',
        'EFI_CHARGES_WEBHOOK_BASE_URL',
      ] as const) {
        if (env[field] && !env[field].startsWith('https://'))
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: `${field} deve usar HTTPS em produção`,
          });
      }
    }
    // Without these the WhatsApp channel stays unconfigured (allowed outside production;
    // the META_* identifiers are required above).
    if (env.NODE_ENV === 'production') {
      for (const field of [
        'DATAFY_API_TOKEN',
        'DATAFY_WEBHOOK_SECRET',
        'DATAFY_WEBHOOK_BASE_URL',
      ] as const) {
        if (!env[field]?.trim())
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: `${field} é obrigatória em produção`,
          });
      }
    }
    for (const field of [
      'META_PHONE_NUMBER_ID',
      'META_BUSINESS_ACCOUNT_ID',
    ] as const) {
      if (env[field] && !/^\d{1,64}$/.test(env[field]))
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} deve ser um ID numerico`,
        });
    }
    if (env.DATAFY_API_TOKEN && !/^sk_live_[^\s]+$/.test(env.DATAFY_API_TOKEN))
      ctx.addIssue({
        code: 'custom',
        path: ['DATAFY_API_TOKEN'],
        message: 'DATAFY_API_TOKEN deve ter o formato sk_live_',
      });
    if (
      env.DATAFY_WEBHOOK_SECRET &&
      !/^whsec_[^\s]+$/.test(env.DATAFY_WEBHOOK_SECRET)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['DATAFY_WEBHOOK_SECRET'],
        message: 'DATAFY_WEBHOOK_SECRET deve ter o formato whsec_',
      });
    if (
      env.DATAFY_WEBHOOK_SECRET_PREVIOUS &&
      (!/^whsec_[^\s]+$/.test(env.DATAFY_WEBHOOK_SECRET_PREVIOUS) ||
        env.DATAFY_WEBHOOK_SECRET_PREVIOUS === env.DATAFY_WEBHOOK_SECRET ||
        !env.DATAFY_WEBHOOK_SECRET)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['DATAFY_WEBHOOK_SECRET_PREVIOUS'],
        message:
          'DATAFY_WEBHOOK_SECRET_PREVIOUS deve ter o formato whsec_, diferente do segredo atual e acompanhado dele',
      });
    if (
      env.NODE_ENV === 'production' &&
      env.DATAFY_WEBHOOK_BASE_URL &&
      !isPublicHttpsWebhook(env.DATAFY_WEBHOOK_BASE_URL)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['DATAFY_WEBHOOK_BASE_URL'],
        message:
          'DATAFY_WEBHOOK_BASE_URL deve apontar para /webhooks/datafy em um dominio publico HTTPS sem credenciais ou parametros',
      });
    if (env.PAYMENT_ENCRYPTION_KEYS || env.PAYMENT_ACTIVE_KEY_VERSION) {
      try {
        new PaymentCryptoService(new ConfigService(env)).encrypt(
          'configuration-check',
        );
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['PAYMENT_ENCRYPTION_KEYS'],
          message:
            'PAYMENT_ENCRYPTION_KEYS e PAYMENT_ACTIVE_KEY_VERSION devem definir chaves de 256 bits válidas',
        });
      }
    }
    if (env.NODE_ENV === 'production' && !env.AUTH_RESEND_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_RESEND_API_KEY'],
        message: 'AUTH_RESEND_API_KEY é obrigatória em produção',
      });
    }
    if (env.NODE_ENV === 'production' && !env.AUTH_EMAIL_FROM) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_EMAIL_FROM'],
        message: 'AUTH_EMAIL_FROM é obrigatória em produção',
      });
    }
    if (
      env.NODE_ENV === 'production' &&
      !env.FRONTEND_URL.startsWith('https://')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FRONTEND_URL'],
        message: 'FRONTEND_URL deve usar HTTPS em produção',
      });
    }
    if (
      env.RESEND_WEBHOOK_SECRET &&
      !env.RESEND_WEBHOOK_SECRET.startsWith('whsec_')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RESEND_WEBHOOK_SECRET'],
        message: 'RESEND_WEBHOOK_SECRET deve comecar com whsec_',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

// Optional settings left blank in api.env (the VPS template lists every key)
// mean "not configured", not an invalid value.
const BLANK_MEANS_ABSENT = [
  'EFI_OPENING_CLIENT_ID',
  'EFI_OPENING_CLIENT_SECRET',
  'EFI_OPENING_CERT_PATH',
  'EFI_OPENING_CERT_PASSWORD',
  'EFI_PLATFORM_CLIENT_ID',
  'EFI_PLATFORM_CLIENT_SECRET',
  'EFI_PLATFORM_CERT_PATH',
  'EFI_PLATFORM_CERT_PASSWORD',
  'PLATFORM_ALERT_EMAIL',
];

export const validateEnv = (config: Record<string, unknown>): Env => {
  const normalized = { ...config };
  for (const key of BLANK_MEANS_ABSENT)
    if (typeof normalized[key] === 'string' && !normalized[key].trim())
      delete normalized[key];
  const parsed = envSchema.safeParse(normalized);
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Variáveis de ambiente inválidas:\n${formatted}`);
  }
  return parsed.data;
};
