import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  readMinimumSeedInput,
  seedMinimumProduction,
} from './minimum-production-seed';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply'))
    throw new Error('Use somente --apply ou nenhum argumento para simular.');
  const input = readMinimumSeedInput(process.env);
  const prisma = new PrismaService(new ConfigService(process.env));
  try {
    const result = await seedMinimumProduction(
      prisma,
      input,
      args.includes('--apply'),
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await prisma.onModuleDestroy();
  }
}
void main().catch(() => {
  process.stderr.write(
    'Seed interrompido: confira variáveis SEED_*, senha forte e banco vazio. Nenhum segredo foi registrado.\n',
  );
  process.exitCode = 1;
});
