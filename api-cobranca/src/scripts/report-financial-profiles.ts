import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { buildFinancialProfileReport } from '../financial-activation/financial-profile-report';

async function main(): Promise<void> {
  if (process.argv.length > 2)
    throw new Error('Este relatório não aceita argumentos');
  const config = new ConfigService(process.env);
  const prisma = new PrismaService(config);
  try {
    const report = await buildFinancialProfileReport(prisma);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally {
    await prisma.onModuleDestroy();
  }
}

void main().catch((): void => {
  process.stderr.write(
    'Relatório interrompido. Verifique a conexão com o banco; nenhum dado foi alterado.\n',
  );
  process.exitCode = 1;
});
