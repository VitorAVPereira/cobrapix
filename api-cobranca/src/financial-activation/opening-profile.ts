import { BillingMethod, GatewayAccount, Prisma } from '@prisma/client';
import { createHash } from 'crypto';

type Db = Pick<Prisma.TransactionClient, 'company'>;

// Opening requests still in progress at Efí or awaiting its outcome. They
// must be reconciled explicitly before a manual activation replaces them.
export const OPENING_IN_FLIGHT: readonly string[] = [
  'NOTICE_PENDING',
  'AWAITING_REPRESENTATIVE',
  'EFI_PROCESSING',
  'SUBMISSION_UNCERTAIN',
  'PROVISIONING',
];

// A manual activation owns the company's financial configuration: the opening
// flow must not submit, provision or overwrite anything while it is active.
export async function hasActiveManualProfile(
  db: Db,
  companyId: string,
): Promise<boolean> {
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: {
      activeFinancialProfile: { select: { status: true, origin: true } },
    },
  });
  const profile = company?.activeFinancialProfile;
  return profile?.status === 'ACTIVE' && profile.origin === 'MANUAL_ADMIN';
}

export interface OpeningProfileInput {
  companyId: string;
  onboardingId: string;
  draftRevision: number;
  requestId: string;
  // Provisioned account with credentials, certificate and Pix key.
  account: GatewayAccount;
}

export class OpeningProfileConflict extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

// Publishes the account provisioned by the opening API as an
// AUTOMATIC_OPENING + CUSTOMER_ACCOUNT profile, inside the caller's
// transaction, so opening and manual activation share one source of truth.
export async function publishOpeningProfile(
  tx: Prisma.TransactionClient,
  input: OpeningProfileInput,
): Promise<string> {
  const { account, companyId } = input;
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "Company" WHERE id=${companyId} FOR UPDATE`,
  );
  const company = await tx.company.findUniqueOrThrow({
    where: { id: companyId },
    select: {
      document: true,
      enabledBillingMethods: true,
      activeFinancialProfile: { select: { id: true, origin: true } },
    },
  });
  if (company.activeFinancialProfile?.origin === 'MANUAL_ADMIN')
    throw new OpeningProfileConflict('FINANCIAL_MANUAL_ACTIVE');
  if (
    !account.encryptedCertificate ||
    !account.certificateExpiresAt ||
    !account.certificateFingerprint ||
    !account.pixKey
  )
    throw new OpeningProfileConflict('EFI_ACCOUNT_INCOMPLETE');

  const environment =
    account.environment === 'production' ? 'PRODUCTION' : 'HOMOLOGATION';
  let identity = await tx.efiAccountIdentity.findUnique({
    where: {
      environment_efiAccountNumber: {
        environment,
        efiAccountNumber: account.efiAccountNumber,
      },
    },
  });
  if (
    identity &&
    (identity.ownership !== 'COMPANY' ||
      identity.companyId !== companyId ||
      identity.holderDocument !== company.document)
  )
    throw new OpeningProfileConflict('ACCOUNT_ALREADY_REGISTERED');
  identity ??= await tx.efiAccountIdentity.create({
    data: {
      ownership: 'COMPANY',
      companyId,
      environment,
      // The opening request was submitted with this document (checked by the provisioner).
      holderDocument: company.document,
      efiAccountNumber: account.efiAccountNumber,
      efiAccountDigit: account.efiAccountDigit,
      payeeCode: account.payeeCode,
      pixKey: account.pixKey,
      healthStatus: 'HEALTHY',
      lastValidatedAt: new Date(),
    },
  });

  const now = new Date();
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "EfiAccountIdentity" WHERE id=${identity.id} FOR UPDATE`,
  );
  const latestCredential = await tx.efiCredentialVersion.findFirst({
    where: { identityId: identity.id },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  await tx.efiCredentialVersion.updateMany({
    where: { identityId: identity.id, status: 'ACTIVE' },
    data: { status: 'RETIRED', retiredAt: now },
  });
  const credential = await tx.efiCredentialVersion.create({
    data: {
      identityId: identity.id,
      version: (latestCredential?.version ?? 0) + 1,
      status: 'ACTIVE',
      encryptedClientId: account.encryptedClientId,
      encryptedClientSecret: account.encryptedClientSecret,
      encryptedCertificate: account.encryptedCertificate,
      encryptedCertificatePassword: account.encryptedCertificatePassword,
      credentialKeyVersion: account.credentialKeyVersion,
      certificateFingerprint: account.certificateFingerprint,
      certificateExpiresAt: account.certificateExpiresAt,
      activatedAt: now,
    },
  });

  if (company.activeFinancialProfile)
    await tx.financialProfileVersion.updateMany({
      where: { id: company.activeFinancialProfile.id, status: 'ACTIVE' },
      data: { status: 'SUPERSEDED', supersededAt: now },
    });
  const latestProfile = await tx.financialProfileVersion.findFirst({
    where: { companyId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const methods = company.enabledBillingMethods.filter(
    (method): method is Extract<BillingMethod, 'PIX' | 'BOLIX'> =>
      method === 'PIX' || method === 'BOLIX',
  );
  const reference = `efi-opening:${input.requestId}`;
  const key = `opening-${input.onboardingId}-${input.draftRevision}`;
  const profile = await tx.financialProfileVersion.create({
    data: {
      companyId,
      version: (latestProfile?.version ?? 0) + 1,
      status: 'ACTIVE',
      origin: 'AUTOMATIC_OPENING',
      accountMode: 'CUSTOMER_ACCOUNT',
      payoutMode: 'DIRECT_TO_CUSTOMER',
      environment,
      enabledMethods: methods.length > 0 ? methods : ['PIX', 'BOLIX'],
      issuerIdentityId: identity.id,
      issuerCredentialVersionId: credential.id,
      // Consent and ownership come from the opening request itself.
      authorizationKind: 'ACCOUNT_OPENING_CONSENT',
      authorizationReference: reference,
      ownershipVerifiedAt: now,
      ownershipEvidenceReference: reference,
      validatedAt: now,
      validationHash: createHash('sha256')
        .update(
          `${reference}:${identity.id}:${credential.certificateFingerprint}`,
        )
        .digest('hex'),
      creationIdempotencyKey: key,
      activationIdempotencyKey: `${key}-activation`,
      activatedAt: now,
    },
  });
  await tx.company.update({
    where: { id: companyId },
    data: { activeFinancialProfileId: profile.id },
  });
  await tx.gatewayAccount.update({
    where: { companyId },
    data: { efiAccountIdentityId: identity.id },
  });
  return profile.id;
}

// After the opening flow renews the certificate of the gateway account, the
// same identity gets a new ACTIVE credential version with those ciphertexts.
// Idempotent: nothing changes when the active version already matches.
export async function syncOpeningCredential(
  prisma: {
    $transaction<T>(
      fn: (tx: Prisma.TransactionClient) => Promise<T>,
    ): Promise<T>;
  },
  companyId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const account = await tx.gatewayAccount.findUnique({
      where: { companyId },
    });
    if (
      !account?.efiAccountIdentityId ||
      !account.encryptedCertificate ||
      !account.certificateExpiresAt ||
      !account.certificateFingerprint
    )
      return;
    const identityId = account.efiAccountIdentityId;
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "EfiAccountIdentity" WHERE id=${identityId} FOR UPDATE`,
    );
    const active = await tx.efiCredentialVersion.findFirst({
      where: { identityId, status: 'ACTIVE' },
      select: { certificateFingerprint: true },
    });
    if (active?.certificateFingerprint === account.certificateFingerprint)
      return;
    const latest = await tx.efiCredentialVersion.findFirst({
      where: { identityId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const now = new Date();
    await tx.efiCredentialVersion.updateMany({
      where: { identityId, status: 'ACTIVE' },
      data: { status: 'RETIRED', retiredAt: now },
    });
    await tx.efiCredentialVersion.create({
      data: {
        identityId,
        version: (latest?.version ?? 0) + 1,
        status: 'ACTIVE',
        encryptedClientId: account.encryptedClientId,
        encryptedClientSecret: account.encryptedClientSecret,
        encryptedCertificate: account.encryptedCertificate,
        encryptedCertificatePassword: account.encryptedCertificatePassword,
        credentialKeyVersion: account.credentialKeyVersion,
        certificateFingerprint: account.certificateFingerprint,
        certificateExpiresAt: account.certificateExpiresAt,
        activatedAt: now,
      },
    });
  });
}
