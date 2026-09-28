import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { TemplatePendingService } from '../communications/template-pending.service';
import { TemplatePolicyService } from '../templates/template-policy.service';
import { TemplateTransitionService } from '../templates/template-transition.service';

const MODES = ['--preflight', '--apply', '--verify'] as const;
type Mode = (typeof MODES)[number];

/**
 * Transition to the imported WhatsApp catalog. Minimal bootstrap: database and payload
 * decryption only, no AppModule, cron, queue workers or provider calls. Prints counts
 * and step IDs only; never environment values, message bodies or phone numbers.
 *
 *   --preflight  read-only; also runs on the schema before the new migrations
 *   --apply      needs the new migrations and the WhatsApp channel paused; idempotent
 *   --verify     read-only invariants after apply
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !(MODES as readonly string[]).includes(args[0]!))
    throw new UsageError();
  const mode = args[0] as Mode;
  const config = new ConfigService(process.env);
  const prisma = new PrismaService(config);
  try {
    const service = new TemplateTransitionService(
      prisma,
      new PaymentCryptoService(config),
      new TemplatePendingService(prisma, new TemplatePolicyService(config)),
    );
    const report =
      mode === '--preflight'
        ? await service.preflight()
        : mode === '--apply'
          ? await service.apply()
          : await service.verify();
    process.stdout.write(`${JSON.stringify({ mode, ...report }, null, 2)}\n`);
    if (
      ('canApply' in report && !report.canApply) ||
      ('ok' in report && !report.ok)
    )
      process.exitCode = 2;
  } finally {
    await prisma.onModuleDestroy();
  }
}

class UsageError extends Error {
  constructor() {
    super('Use exatamente um de: --preflight, --apply, --verify.');
  }
}

void main().catch((error: unknown): void => {
  // Operational messages of this script carry no secrets; anything else stays generic.
  const known =
    error instanceof UsageError ||
    (error instanceof Error &&
      /^(Pause o canal|Aplique as migrations|\d+ envio)/.test(error.message));
  process.stderr.write(
    `${known ? (error as Error).message : 'Transição interrompida. Verifique a conexão e o estado dos registros; nenhum dado sensível foi registrado.'}\n`,
  );
  process.exitCode = 1;
});
