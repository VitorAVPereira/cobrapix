import { z } from 'zod';
import { ConfigService } from '@nestjs/config';
import { PaymentCryptoService } from '../payment/payment-crypto.service';

function hasValidSenderEmail(value: string): boolean {
  const displayNameMatch = value.match(/^.+<([^<>]+)>$/);
  const email = (displayNameMatch?.[1] ?? value).trim();
  return z.string().email().safeParse(email).success;
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
    META_GRAPH_API_VERSION: z.string().default('v23.0'),
    META_ACCESS_TOKEN: z.string().min(1).optional(),
    META_PHONE_NUMBER_ID: z.string().min(1).optional(),
    META_BUSINESS_ACCOUNT_ID: z.string().min(1).optional(),
    META_BUSINESS_PHONE_NUMBER: z.string().optional(),
    META_DEFAULT_LANGUAGE: z.string().default('pt_BR'),
    META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
    META_WEBHOOK_BASE_URL: z.string().url().optional(),
    META_APP_SECRET: z.string().optional(),
    JWT_SECRET: z
      .string()
      .min(32, 'JWT_SECRET deve ter pelo menos 32 caracteres'),
    FRONTEND_URL: z.string().url().default('http://localhost:3000'),
    EFI_ENV: z.enum(['homologation', 'production']).default('homologation'),
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
      'META_ACCESS_TOKEN',
      'META_PHONE_NUMBER_ID',
      'META_BUSINESS_ACCOUNT_ID',
      'META_APP_SECRET',
      'META_WEBHOOK_VERIFY_TOKEN',
      'META_WEBHOOK_BASE_URL',
      'RESEND_API_KEY',
      'RESEND_FROM_EMAIL',
      'RESEND_REPLY_TO',
      'RESEND_WEBHOOK_SECRET',
      'EFI_OPENING_CLIENT_ID',
      'EFI_OPENING_CLIENT_SECRET',
      'EFI_OPENING_CERT_PATH',
      'EFI_PLATFORM_CLIENT_ID',
      'EFI_PLATFORM_CLIENT_SECRET',
      'EFI_PLATFORM_CERT_PATH',
      'EFI_PLATFORM_PAYEE_CODE',
      'EFI_PLATFORM_ACCOUNT_NUMBER',
      'EFI_PLATFORM_CNPJ',
      'EFI_WEBHOOK_BASE_URL',
      'PAYMENT_ENCRYPTION_KEYS',
      'PAYMENT_ACTIVE_KEY_VERSION',
    ] as const;
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
        'META_WEBHOOK_BASE_URL',
      ] as const) {
        if (env[field] && !env[field].startsWith('https://'))
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: `${field} deve usar HTTPS em produção`,
          });
      }
    }
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

export const validateEnv = (config: Record<string, unknown>): Env => {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Variáveis de ambiente inválidas:\n${formatted}`);
  }
  return parsed.data;
};
