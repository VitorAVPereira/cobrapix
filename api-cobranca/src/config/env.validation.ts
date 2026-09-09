import { z } from 'zod';

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
    META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
    META_WEBHOOK_BASE_URL: z.string().url().optional(),
    META_APP_SECRET: z.string().optional(),
    JWT_SECRET: z
      .string()
      .min(32, 'JWT_SECRET deve ter pelo menos 32 caracteres'),
    FRONTEND_URL: z.string().url().default('http://localhost:3000'),
    EFI_ENV: z.enum(['homologation', 'production']).default('homologation'),
    EFI_PLATFORM_CLIENT_ID: z.string().optional(),
    EFI_PLATFORM_CLIENT_SECRET: z.string().optional(),
    EFI_PLATFORM_CERT_PATH: z.string().optional(),
    EFI_PLATFORM_CERT_PASSWORD: z.string().optional(),
    EFI_PLATFORM_PAYEE_CODE: z.string().optional(),
    EFI_PLATFORM_ACCOUNT_NUMBER: z.string().optional(),
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
