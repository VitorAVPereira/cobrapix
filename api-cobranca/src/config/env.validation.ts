import { z } from 'zod';

/**
 * Schema de validação das variáveis de ambiente do api-cobranca.
 *
 * Executado no bootstrap via `ConfigModule.forRoot({ validate: validateEnv })`.
 * Falha rápido com mensagem legível quando qualquer var obrigatória está ausente
 * ou fora do formato esperado.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  EVOLUTION_API_URL: z.string().url().default('http://localhost:8080'),
  EVOLUTION_API_KEY: z.string().min(1, 'EVOLUTION_API_KEY é obrigatória'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET deve ter pelo menos 32 caracteres'),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),
  EFI_ENV: z.enum(['homologation', 'production']).default('homologation'),
  EFI_PLATFORM_CLIENT_ID: z.string().optional(),
  EFI_PLATFORM_CLIENT_SECRET: z.string().optional(),
  EFI_PLATFORM_CERT_PATH: z.string().optional(),
  EFI_PLATFORM_CERT_PASSWORD: z.string().optional(),
  EFI_PLATFORM_PAYEE_CODE: z.string().optional(),
  EFI_PLATFORM_ACCOUNT_NUMBER: z.string().optional(),
  EFI_PLATFORM_SPLIT_PERCENTAGE: z.coerce.number().int().min(0).max(10000).default(0),
  EFI_WEBHOOK_BASE_URL: z.string().url().optional(),
  PAYMENT_SECRET_KEY: z.string().min(32).optional(),
  ASAAS_API_URL: z.string().url().optional(),
  ASAAS_API_KEY: z.string().optional(),
  ASAAS_MASTER_KEY: z.string().optional(),
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
