import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { TemplatePolicyService } from '../templates/template-policy.service';
import { CollectionTemplateSlotService } from '../templates/collection-template-slot.service';

/**
 * Read-only check before publishing the automatic collection templates: every one of the
 * 18 global templates (moment x payment method) must be chosen and usable. Prints only
 * moments, methods and template names; exits with 2 when any is missing or unusable.
 */
async function main(): Promise<void> {
  const config = new ConfigService(process.env);
  const prisma = new PrismaService(config);
  try {
    const { slots } = await new CollectionTemplateSlotService(
      prisma,
      new TemplatePolicyService(config),
    ).list();
    const missing = slots
      .filter((slot) => !slot.available.ready)
      .map((slot) => ({
        purpose: slot.purpose,
        billingMethod: slot.billingMethod,
        templateName: slot.templateName,
        code: slot.available.code,
      }));
    const ok = missing.length === 0;
    process.stdout.write(
      `${JSON.stringify({ ok, ready: slots.length - missing.length, total: slots.length, missing }, null, 2)}\n`,
    );
    if (!ok) process.exitCode = 2;
  } finally {
    await prisma.onModuleDestroy();
  }
}

void main().catch((): void => {
  process.stderr.write(
    'Conferência interrompida. Verifique a conexão com o banco; nenhum dado sensível foi registrado.\n',
  );
  process.exitCode = 1;
});
