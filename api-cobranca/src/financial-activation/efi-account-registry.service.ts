import { HttpException, Injectable } from '@nestjs/common';
import {
  EfiAccountIdentity,
  EfiCredentialVersion,
  EfiEnvironment,
  Prisma,
} from '@prisma/client';
import type { EfiCertificate } from '../payment/efi-certificate';
import { PaymentCryptoService } from '../payment/payment-crypto.service';

export interface CompanyCredentialInput {
  companyId: string;
  environment: EfiEnvironment;
  holderDocument: string;
  efiAccountNumber: string;
  efiAccountDigit?: string;
  payeeCode: string;
  pixKey?: string;
  clientId: string;
  clientSecret: string;
  certificate: EfiCertificate;
  userId: string;
}

// Wiped content of a credential that never became usable. The columns are
// NOT NULL, and an empty string never decrypts.
const WIPED = '';

@Injectable()
export class EfiAccountRegistryService {
  constructor(private readonly crypto: PaymentCryptoService) {}

  // Finds or creates the company's own identity for this bank account and
  // stores the material as a new CANDIDATE version. An account registered to
  // another company, or with different bank facts, is refused.
  async registerCompanyCredential(
    tx: Prisma.TransactionClient,
    input: CompanyCredentialInput,
  ): Promise<{
    identity: EfiAccountIdentity;
    credential: EfiCredentialVersion;
  }> {
    const existing = await tx.efiAccountIdentity.findUnique({
      where: {
        environment_efiAccountNumber: {
          environment: input.environment,
          efiAccountNumber: input.efiAccountNumber,
        },
      },
    });
    let identity: EfiAccountIdentity;
    if (existing) {
      if (
        existing.ownership !== 'COMPANY' ||
        existing.companyId !== input.companyId
      )
        this.fail(409, 'ACCOUNT_ALREADY_REGISTERED');
      if (
        existing.holderDocument !== input.holderDocument ||
        existing.payeeCode !== input.payeeCode ||
        (existing.efiAccountDigit ?? null) !== (input.efiAccountDigit ?? null)
      )
        this.fail(409, 'ACCOUNT_DATA_MISMATCH');
      if (existing.pixKey && input.pixKey && existing.pixKey !== input.pixKey)
        this.fail(409, 'ACCOUNT_DATA_MISMATCH');
      identity =
        !existing.pixKey && input.pixKey
          ? await tx.efiAccountIdentity.update({
              where: { id: existing.id },
              data: { pixKey: input.pixKey },
            })
          : existing;
    } else {
      identity = await tx.efiAccountIdentity.create({
        data: {
          ownership: 'COMPANY',
          companyId: input.companyId,
          environment: input.environment,
          holderDocument: input.holderDocument,
          efiAccountNumber: input.efiAccountNumber,
          efiAccountDigit: input.efiAccountDigit ?? null,
          payeeCode: input.payeeCode,
          pixKey: input.pixKey ?? null,
        },
      });
    }
    const credential = await this.addCredentialVersion(tx, identity.id, input);
    return { identity, credential };
  }

  // Rotation keeps the identity: a new version for the same account.
  async addCredentialVersion(
    tx: Prisma.TransactionClient,
    identityId: string,
    input: Pick<
      CompanyCredentialInput,
      'clientId' | 'clientSecret' | 'certificate' | 'userId'
    >,
  ): Promise<EfiCredentialVersion> {
    // Serialize version numbers per identity.
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "EfiAccountIdentity" WHERE id=${identityId} FOR UPDATE`,
    );
    const latest = await tx.efiCredentialVersion.findFirst({
      where: { identityId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return tx.efiCredentialVersion.create({
      data: {
        identityId,
        version: (latest?.version ?? 0) + 1,
        status: 'CANDIDATE',
        encryptedClientId: this.crypto.encrypt(input.clientId),
        encryptedClientSecret: this.crypto.encrypt(input.clientSecret),
        // inspectEfiCertificate re-encodes the container without passphrase.
        encryptedCertificate: this.crypto.encrypt(input.certificate.base64),
        encryptedCertificatePassword: null,
        credentialKeyVersion: this.crypto.activeKeyVersion,
        certificateFingerprint: input.certificate.fingerprint,
        certificateExpiresAt: input.certificate.expiresAt,
        createdByUserId: input.userId,
      },
    });
  }

  // A candidate that will never be used keeps its audit facts but loses its secrets.
  async rejectCandidateCredential(
    tx: Prisma.TransactionClient,
    credentialId: string,
  ): Promise<void> {
    await tx.efiCredentialVersion.updateMany({
      where: { id: credentialId, status: 'CANDIDATE' },
      data: {
        status: 'REJECTED',
        retiredAt: new Date(),
        encryptedClientId: WIPED,
        encryptedClientSecret: WIPED,
        encryptedCertificate: WIPED,
        encryptedCertificatePassword: null,
      },
    });
  }

  private fail(status: number, code: string): never {
    throw new HttpException({ code, message: MESSAGES[code] ?? code }, status);
  }
}

const MESSAGES: Record<string, string> = {
  ACCOUNT_ALREADY_REGISTERED:
    'Esta conta Efí já está vinculada a outra empresa ou à plataforma.',
  ACCOUNT_DATA_MISMATCH:
    'Os dados bancários informados diferem dos já registrados para esta conta.',
};
