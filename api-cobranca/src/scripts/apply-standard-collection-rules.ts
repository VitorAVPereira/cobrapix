import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ResendMailerService } from '../common/resend-mailer.service';
import { EmailTemplatesService } from '../email/email-templates.service';
import { CollectionProfileService } from '../billing/collection-profile.service';

const MODES = ['--preview', '--apply'] as const;

/**
 * Moves the standard collection profiles of every company (Novo Cliente, Bom Pagador,
 * Pagador Duvidoso, Mau Pagador) to the current standard schedule. Profiles a company
 * created are not touched. Prints company/profile IDs and schedules only.
 *
 *   --preview  read-only: what would change
 *   --apply    replaces the schedules; idempotent (an updated profile reads UNCHANGED)
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !(MODES as readonly string[]).includes(args[0]!))
    throw new UsageError();
  const config = new ConfigService(process.env);
  const prisma = new PrismaService(config);
  try {
    const service = new CollectionProfileService(
      prisma,
      new EmailTemplatesService(prisma, new ResendMailerService(), config),
    );
    const changes = await service.syncStandardSchedules(args[0] === '--apply');
    const count = (action: string) =>
      changes.filter((change) => change.action === action).length;
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: args[0],
          unchanged: count('UNCHANGED'),
          toReplace: count('WOULD_REPLACE'),
          replaced: count('REPLACED'),
          changes: changes.filter((change) => change.action !== 'UNCHANGED'),
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await prisma.onModuleDestroy();
  }
}

class UsageError extends Error {
  constructor() {
    super('Use exatamente um de: --preview, --apply.');
  }
}

void main().catch((error: unknown): void => {
  process.stderr.write(
    error instanceof UsageError
      ? `${error.message}\n`
      : 'Atualização interrompida. Verifique a conexão com o banco; nenhum dado sensível foi registrado.\n',
  );
  process.exitCode = 1;
});
