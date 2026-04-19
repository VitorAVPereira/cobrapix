import { z } from 'zod';
export declare const envSchema: z.ZodObject<{
    NODE_ENV: z.ZodDefault<z.ZodEnum<{
        development: "development";
        test: "test";
        production: "production";
    }>>;
    PORT: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    DATABASE_URL: z.ZodString;
    EVOLUTION_API_URL: z.ZodDefault<z.ZodString>;
    EVOLUTION_API_KEY: z.ZodString;
    JWT_SECRET: z.ZodString;
    FRONTEND_URL: z.ZodDefault<z.ZodString>;
    ASAAS_API_URL: z.ZodDefault<z.ZodString>;
    ASAAS_API_KEY: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type Env = z.infer<typeof envSchema>;
export declare const validateEnv: (config: Record<string, unknown>) => Env;
