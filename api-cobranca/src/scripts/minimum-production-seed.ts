import { hash } from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

export interface MinimumSeedInput {
  corporateName: string;
  document: string;
  companyEmail: string;
  phoneNumber: string;
  adminEmail: string;
  adminPassword: string;
}

export function readMinimumSeedInput(env: NodeJS.ProcessEnv): MinimumSeedInput {
  const required = (key: string): string => {
    const value = env[key]?.trim();
    if (!value) throw new Error(`Variável obrigatória: ${key}`);
    return value;
  };
  const input: MinimumSeedInput = {
    corporateName: required('SEED_CORPORATE_NAME'),
    document: required('SEED_COMPANY_CNPJ'),
    companyEmail: required('SEED_COMPANY_EMAIL'),
    phoneNumber: required('SEED_COMPANY_PHONE'),
    adminEmail: required('SEED_ADMIN_EMAIL'),
    adminPassword: required('SEED_ADMIN_PASSWORD'),
  };
  if (!/^\d{14}$/.test(input.document))
    throw new Error('CNPJ deve ter 14 dígitos.');
  if (!/^\d{10,15}$/.test(input.phoneNumber))
    throw new Error('Telefone inválido.');
  if (
    ![input.companyEmail, input.adminEmail].every((email) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    )
  )
    throw new Error('Email inválido.');
  if (input.adminPassword.length < 20)
    throw new Error('Senha inicial deve ter ao menos 20 caracteres.');
  return input;
}

/** Initial bootstrap only: never resets an existing administrator or enables fees. */
export async function seedMinimumProduction(
  prisma: PrismaClient,
  input: MinimumSeedInput,
  apply: boolean,
): Promise<{
  mode: 'dry-run' | 'applied';
  companies: number;
  administrators: number;
}> {
  if (!apply) return { mode: 'dry-run', companies: 1, administrators: 1 };
  const password = await hash(input.adminPassword, 12);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73092026)`;
    if (await tx.company.count())
      throw new Error(
        'Seed mínimo exige banco sem empresas; nunca sobrescreve cadastros.',
      );
    const company = await tx.company.create({
      data: {
        corporateName: input.corporateName,
        document: input.document,
        email: input.companyEmail,
        phoneNumber: input.phoneNumber,
        preferredBillingMethod: 'BOLIX',
        enabledBillingMethods: [],
        autoGenerateFirstCharge: false,
      },
    });
    await tx.user.create({
      data: {
        companyId: company.id,
        email: input.adminEmail,
        password,
        role: 'PLATFORM_ADMIN',
        mustChangePassword: true,
      },
    });
    for (const integration of [
      'META',
      'RESEND',
      'EFI_ONBOARDING',
      'EFI_PAYMENTS',
    ] as const) {
      await tx.platformIntegrationState.upsert({
        where: { integration },
        create: {
          integration,
          enabled: false,
          pauseReason: 'Aguardando homologação e configuração inicial.',
        },
        update: {
          enabled: false,
          pausedAt: new Date(),
          pauseReason: 'Bootstrap: aguardando homologação.',
        },
      });
    }
  });
  return { mode: 'applied', companies: 1, administrators: 1 };
}
