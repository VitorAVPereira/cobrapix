"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateEnv = exports.envSchema = void 0;
const zod_1 = require("zod");
exports.envSchema = zod_1.z.object({
    NODE_ENV: zod_1.z
        .enum(['development', 'test', 'production'])
        .default('development'),
    PORT: zod_1.z.coerce.number().int().positive().default(3001),
    DATABASE_URL: zod_1.z.string().min(1, 'DATABASE_URL é obrigatória'),
    EVOLUTION_API_URL: zod_1.z.string().url().default('http://localhost:8080'),
    EVOLUTION_API_KEY: zod_1.z.string().min(1, 'EVOLUTION_API_KEY é obrigatória'),
    JWT_SECRET: zod_1.z.string().min(32, 'JWT_SECRET deve ter pelo menos 32 caracteres'),
    FRONTEND_URL: zod_1.z.string().url().default('http://localhost:3000'),
    ASAAS_API_URL: zod_1.z.string().url().default('https://sandbox.asaas.com/api/v3'),
    ASAAS_API_KEY: zod_1.z.string().optional(),
});
const validateEnv = (config) => {
    const parsed = exports.envSchema.safeParse(config);
    if (!parsed.success) {
        const formatted = parsed.error.issues
            .map((i) => `  ${i.path.join('.')}: ${i.message}`)
            .join('\n');
        throw new Error(`Variáveis de ambiente inválidas:\n${formatted}`);
    }
    return parsed.data;
};
exports.validateEnv = validateEnv;
//# sourceMappingURL=env.validation.js.map