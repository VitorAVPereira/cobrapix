import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from './payment-crypto.service';
import { Prisma } from '@prisma/client';
import { rotateEncryptedFields } from './payment-key-rotation';

export interface RotationOptions {
  apply?: boolean;
  batchSize?: number;
}
export interface RotationSummary {
  apply: boolean;
  inspected: number;
  changed: number;
}

export async function rotatePaymentSecrets(
  prisma: PrismaService,
  crypto: PaymentCryptoService,
  options: RotationOptions = {},
): Promise<RotationSummary> {
  const batchSize = options.batchSize ?? 100;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100)
    throw new Error('Lote deve conter entre 1 e 100 empresas');
  if (crypto.activeKeyVersion === 'legacy')
    throw new Error('Configure uma chave versionada antes da rotação');
  const summary: RotationSummary = {
    apply: options.apply ?? false,
    inspected: 0,
    changed: 0,
  };
  let cursor: string | undefined;
  while (true) {
    // Internal operator-only command, intentionally enumerates tenant IDs, never secrets.
    const companies: Array<{ id: string }> = await prisma.company.findMany({
      where: cursor ? { id: { gt: cursor } } : {},
      select: { id: true },
      orderBy: { id: 'asc' },
      take: batchSize,
    });
    if (companies.length === 0) break;
    const changed = await prisma.$transaction(
      async (tx: Prisma.TransactionClient): Promise<number> => {
        let count = 0;
        for (const company of companies) {
          count += await rotateCompany(tx, company.id, crypto, summary.apply);
        }
        return count;
      },
      { timeout: 60_000 },
    );
    summary.inspected += companies.length;
    summary.changed += changed;
    const lastCompany = companies.at(-1);
    if (!lastCompany) break;
    cursor = lastCompany.id;
  }
  await rotateCredentialVersions(prisma, crypto, summary, batchSize);
  return summary;
}

// Credential versions of every identity (company or platform). Wiped
// versions (empty ciphertext) have nothing to rotate.
async function rotateCredentialVersions(
  prisma: PrismaService,
  crypto: PaymentCryptoService,
  summary: RotationSummary,
  batchSize: number,
): Promise<void> {
  let cursor: string | undefined;
  while (true) {
    const rows = await prisma.efiCredentialVersion.findMany({
      where: cursor ? { id: { gt: cursor } } : {},
      orderBy: { id: 'asc' },
      take: batchSize,
    });
    if (rows.length === 0) break;
    const changed = await prisma.$transaction(
      async (tx: Prisma.TransactionClient): Promise<number> => {
        let count = 0;
        for (const row of rows) {
          const present = (value: string | null): string | null =>
            value ? value : null;
          const rotation = rotateEncryptedFields(
            {
              encryptedClientId: present(row.encryptedClientId),
              encryptedClientSecret: present(row.encryptedClientSecret),
              encryptedCertificate: present(row.encryptedCertificate),
              encryptedCertificatePassword: present(
                row.encryptedCertificatePassword,
              ),
            },
            crypto,
          );
          if (!rotation.changed) continue;
          count++;
          if (!summary.apply) continue;
          const result = await tx.efiCredentialVersion.updateMany({
            where: { id: row.id, updatedAt: row.updatedAt },
            data: {
              encryptedClientId:
                rotation.fields.encryptedClientId ?? row.encryptedClientId,
              encryptedClientSecret:
                rotation.fields.encryptedClientSecret ??
                row.encryptedClientSecret,
              encryptedCertificate:
                rotation.fields.encryptedCertificate ??
                row.encryptedCertificate,
              encryptedCertificatePassword:
                rotation.fields.encryptedCertificatePassword,
              credentialKeyVersion: crypto.activeKeyVersion,
            },
          });
          if (result.count !== 1)
            throw new Error('Registro alterado durante rotação');
        }
        return count;
      },
      { timeout: 60_000 },
    );
    summary.inspected += rows.length;
    summary.changed += changed;
    cursor = rows.at(-1)?.id;
  }
}

async function rotateCompany(
  tx: Prisma.TransactionClient,
  companyId: string,
  crypto: PaymentCryptoService,
  apply: boolean,
): Promise<number> {
  let changed = 0;
  const gateway = await tx.gatewayAccount.findUnique({ where: { companyId } });
  if (gateway) {
    const rotation = rotateEncryptedFields(
      {
        encryptedClientId: gateway.encryptedClientId,
        encryptedClientSecret: gateway.encryptedClientSecret,
        encryptedCertificate: gateway.encryptedCertificate,
        encryptedCertificatePassword: gateway.encryptedCertificatePassword,
      },
      crypto,
    );
    if (rotation.changed) {
      changed++;
      if (apply) {
        const result = await tx.gatewayAccount.updateMany({
          where: { companyId, updatedAt: gateway.updatedAt },
          data: {
            ...rotation.fields,
            credentialKeyVersion: crypto.activeKeyVersion,
          },
        });
        if (result.count !== 1)
          throw new Error('Registro alterado durante rotação');
      }
    }
  }
  const onboarding = await tx.efiOnboarding.findUnique({
    where: { companyId },
  });
  if (onboarding) {
    const rotation = rotateEncryptedFields(
      {
        representativeNameEncrypted: onboarding.representativeNameEncrypted,
        representativeCpfEncrypted: onboarding.representativeCpfEncrypted,
        representativeBirthDateEncrypted:
          onboarding.representativeBirthDateEncrypted,
        representativeMotherNameEncrypted:
          onboarding.representativeMotherNameEncrypted,
        representativeEmailEncrypted: onboarding.representativeEmailEncrypted,
        representativePhoneEncrypted: onboarding.representativePhoneEncrypted,
      },
      crypto,
    );
    if (rotation.changed) {
      changed++;
      if (apply) {
        const result = await tx.efiOnboarding.updateMany({
          where: { companyId, updatedAt: onboarding.updatedAt },
          data: {
            ...rotation.fields,
            sensitiveDataKeyVersion: crypto.activeKeyVersion,
          },
        });
        if (result.count !== 1)
          throw new Error('Registro alterado durante rotação');
      }
    }
  }
  return changed;
}
