import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { rotatePaymentSecrets } from '../payment/rotate-payment-secrets';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg: string): boolean => arg !== '--apply'))
    throw new Error('Argumento inválido; use --apply para aplicar');
  const config = new ConfigService(process.env);
  const prisma = new PrismaService(config);
  try {
    const summary = await rotatePaymentSecrets(
      prisma,
      new PaymentCryptoService(config),
      { apply: args.includes('--apply') },
    );
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await prisma.onModuleDestroy();
  }
}

void main().catch((): void => {
  process.stderr.write(
    'Rotação interrompida. Verifique as chaves, a conexão e o estado dos registros; nenhum segredo foi registrado.\n',
  );
  process.exitCode = 1;
});
