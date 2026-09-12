import { PrismaClient } from '@prisma/client';
import {
  readMinimumSeedInput,
  seedMinimumProduction,
} from './minimum-production-seed';

describe('minimum production seed', () => {
  const env = {
    SEED_CORPORATE_NAME: 'Operadora',
    SEED_COMPANY_CNPJ: '12345678000195',
    SEED_COMPANY_EMAIL: 'company@example.test',
    SEED_COMPANY_PHONE: '5511999999999',
    SEED_ADMIN_EMAIL: 'admin@example.test',
    SEED_ADMIN_PASSWORD: 'temporary-strong-password-fixture',
  };
  it('has no built-in production credentials', () => {
    expect(() => readMinimumSeedInput({})).toThrow('Variável obrigatória');
    expect(() =>
      readMinimumSeedInput({ ...env, SEED_ADMIN_PASSWORD: 'senha123' }),
    ).toThrow('20 caracteres');
  });
  it('dry run never connects or writes', async () => {
    await expect(
      seedMinimumProduction(
        {} as PrismaClient,
        readMinimumSeedInput(env),
        false,
      ),
    ).resolves.toEqual({ mode: 'dry-run', companies: 1, administrators: 1 });
  });
});
