import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  FinancialProfileStatus,
  FinancialProfileVersion,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { inspectEfiCertificate } from '../payment/efi-certificate';
import type { EfiCertificate } from '../payment/efi-certificate';
import { EfiAccountRegistryService } from './efi-account-registry.service';
import {
  CancelFinancialActivationDto,
  CreateFinancialActivationDto,
  UpdateFinancialConfigurationDto,
  UploadFinancialCredentialsDto,
} from './financial-activation.dto';
import { validateFinancialModeSelection } from './financial-activation.types';

export const OPEN_CANDIDATE_STATUSES: FinancialProfileStatus[] = [
  'DRAFT',
  'VALIDATING',
  'READY',
  'VALIDATION_FAILED',
];
export const CERTIFICATE_MAX_BYTES = 1024 * 1024;
// Abandoned candidates expire and lose their secrets after this period.
export const CANDIDATE_RETENTION_DAYS = 7;
const AUDIT_RETENTION_MS = 5 * 365.25 * 86400_000;

export interface UploadedCertificateFile {
  buffer: Buffer;
  size: number;
}

const profileView = {
  include: {
    issuerIdentity: {
      select: {
        id: true,
        ownership: true,
        holderDocument: true,
        efiAccountNumber: true,
        payeeCode: true,
        pixKey: true,
      },
    },
    // Never load encrypted material into a response path.
    issuerCredentialVersion: {
      select: {
        version: true,
        status: true,
        certificateFingerprint: true,
        certificateExpiresAt: true,
      },
    },
  },
} satisfies Prisma.FinancialProfileVersionDefaultArgs;
type ProfileWithIssuer = Prisma.FinancialProfileVersionGetPayload<
  typeof profileView
>;

export interface FinancialProfileView {
  id: string;
  companyId: string;
  version: number;
  revision: number;
  status: FinancialProfileStatus;
  origin: string;
  accountMode: string;
  payoutMode: string;
  environment: string;
  enabledMethods: string[];
  authorization: {
    kind: string | null;
    reference: string | null;
    validUntil: Date | null;
  };
  ownership: {
    verifiedAt: Date | null;
    verifiedByUserId: string | null;
    evidenceReference: string | null;
  };
  issuer: {
    id: string;
    ownership: string;
    holderDocument: string;
    efiAccountNumber: string;
    payeeCode: string | null;
    pixKey: string | null;
  } | null;
  credential: {
    version: number;
    status: string;
    certificateFingerprint: string;
    certificateExpiresAt: Date;
  } | null;
  validatedAt: Date | null;
  activatedAt: Date | null;
  supersededAt: Date | null;
  canceledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class FinancialActivationService {
  private readonly logger = new Logger(FinancialActivationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: EfiAccountRegistryService,
  ) {}

  async getOverview(companyId: string): Promise<{
    companyId: string;
    active: FinancialProfileView | null;
    candidate: FinancialProfileView | null;
  }> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, activeFinancialProfileId: true },
    });
    if (!company) this.fail(404, 'COMPANY_NOT_FOUND');
    const [active, candidate] = await Promise.all([
      company.activeFinancialProfileId
        ? this.prisma.financialProfileVersion.findFirst({
            where: { id: company.activeFinancialProfileId, companyId },
            ...profileView,
          })
        : null,
      this.prisma.financialProfileVersion.findFirst({
        where: { companyId, status: { in: OPEN_CANDIDATE_STATUSES } },
        ...profileView,
      }),
    ]);
    return {
      companyId,
      active: active ? this.toView(active) : null,
      candidate: candidate ? this.toView(candidate) : null,
    };
  }

  async getActivation(id: string): Promise<FinancialProfileView> {
    const profile = await this.prisma.financialProfileVersion.findUnique({
      where: { id },
      ...profileView,
    });
    if (!profile) this.fail(404, 'FINANCIAL_ACTIVATION_NOT_FOUND');
    return this.toView(profile);
  }

  async createCandidate(
    companyId: string,
    userId: string,
    dto: CreateFinancialActivationDto,
  ): Promise<FinancialProfileView> {
    const mode = validateFinancialModeSelection({
      origin: 'MANUAL_ADMIN',
      accountMode: dto.accountMode,
      payoutMode: dto.payoutMode,
    });
    if (!mode.valid) this.fail(422, 'FINANCIAL_MODE_INVALID');
    // Phase A delivers the company's own account; platform modes come in phase B.
    if (dto.accountMode !== 'CUSTOMER_ACCOUNT')
      this.fail(422, 'FINANCIAL_MODE_NOT_AVAILABLE');
    const methods = [...dto.enabledMethods].sort();

    const id = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM "Company" WHERE id=${companyId} FOR UPDATE`,
      );
      if (locked.length === 0) this.fail(404, 'COMPANY_NOT_FOUND');
      const replay = await tx.financialProfileVersion.findUnique({
        where: { creationIdempotencyKey: dto.idempotencyKey },
      });
      if (replay) {
        const same =
          replay.companyId === companyId &&
          replay.accountMode === dto.accountMode &&
          replay.payoutMode === dto.payoutMode &&
          replay.environment === dto.environment &&
          [...replay.enabledMethods].sort().join() === methods.join();
        if (!same) this.fail(409, 'IDEMPOTENCY_KEY_REUSED');
        return replay.id;
      }
      const open = await tx.financialProfileVersion.findFirst({
        where: { companyId, status: { in: OPEN_CANDIDATE_STATUSES } },
        select: { id: true },
      });
      if (open) this.fail(409, 'CANDIDATE_ALREADY_OPEN');
      const latest = await tx.financialProfileVersion.findFirst({
        where: { companyId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const created = await tx.financialProfileVersion.create({
        data: {
          companyId,
          version: (latest?.version ?? 0) + 1,
          origin: 'MANUAL_ADMIN',
          accountMode: dto.accountMode,
          payoutMode: dto.payoutMode,
          environment: dto.environment,
          enabledMethods: methods,
          authorizationKind: 'ACCOUNT_INTEGRATION_AUTHORIZATION',
          creationIdempotencyKey: dto.idempotencyKey,
          createdByUserId: userId,
        },
      });
      await this.audit(tx, created, userId, 'FINANCIAL_ACTIVATION_CREATED', {
        accountMode: dto.accountMode,
        payoutMode: dto.payoutMode,
        environment: dto.environment,
        enabledMethods: methods,
      });
      return created.id;
    });
    return this.getActivation(id);
  }

  async updateConfiguration(
    id: string,
    userId: string,
    dto: UpdateFinancialConfigurationDto,
  ): Promise<FinancialProfileView> {
    await this.prisma.$transaction(async (tx) => {
      const profile = await this.lockOpenCandidate(
        tx,
        id,
        dto.expectedRevision,
      );
      const data: Prisma.FinancialProfileVersionUncheckedUpdateManyInput = {};
      const changes: Record<string, unknown> = {};
      if (dto.enabledMethods) {
        data.enabledMethods = [...dto.enabledMethods].sort();
        changes.enabledMethods = data.enabledMethods;
      }
      if (dto.authorizationReference !== undefined) {
        data.authorizationReference = dto.authorizationReference.trim();
        changes.authorizationReference = data.authorizationReference;
      }
      if (dto.authorizationValidUntil !== undefined) {
        const validUntil = new Date(dto.authorizationValidUntil);
        if (validUntil.getTime() <= Date.now())
          this.fail(422, 'AUTHORIZATION_EXPIRED');
        data.authorizationValidUntil = validUntil;
        changes.authorizationValidUntil = validUntil;
      }
      if (dto.ownershipVerifiedDocument !== undefined) {
        const company = await tx.company.findUniqueOrThrow({
          where: { id: profile.companyId },
          select: { document: true },
        });
        const evidence =
          dto.ownershipEvidenceReference?.trim() ??
          profile.ownershipEvidenceReference;
        if (!evidence) this.fail(422, 'OWNERSHIP_EVIDENCE_REQUIRED');
        // Attestation compares the account holder with the company document.
        if (dto.ownershipVerifiedDocument !== company.document)
          this.fail(422, 'ACCOUNT_OWNERSHIP_UNVERIFIED');
        if (profile.issuerIdentityId) {
          const identity = await tx.efiAccountIdentity.findUniqueOrThrow({
            where: { id: profile.issuerIdentityId },
            select: { holderDocument: true },
          });
          if (identity.holderDocument !== company.document)
            this.fail(422, 'ACCOUNT_OWNERSHIP_UNVERIFIED');
        }
        data.ownershipVerifiedAt = new Date();
        data.ownershipVerifiedByUserId = userId;
        data.ownershipEvidenceReference = evidence;
        changes.ownershipVerified = true;
        changes.ownershipEvidenceReference = evidence;
      } else if (dto.ownershipEvidenceReference !== undefined) {
        // New evidence without a new attestation voids the previous one.
        data.ownershipEvidenceReference = dto.ownershipEvidenceReference.trim();
        data.ownershipVerifiedAt = null;
        data.ownershipVerifiedByUserId = null;
        changes.ownershipEvidenceReference = data.ownershipEvidenceReference;
        changes.ownershipVerified = false;
      }
      if (Object.keys(changes).length === 0)
        this.fail(422, 'NOTHING_TO_UPDATE');
      await this.bumpRevision(tx, profile, data);
      await this.audit(
        tx,
        profile,
        userId,
        'FINANCIAL_ACTIVATION_CONFIGURED',
        changes,
      );
    });
    return this.getActivation(id);
  }

  async uploadCredentials(
    id: string,
    userId: string,
    dto: UploadFinancialCredentialsDto,
    file: UploadedCertificateFile | undefined,
  ): Promise<FinancialProfileView> {
    if (!file || file.size === 0) this.fail(422, 'CERTIFICATE_REQUIRED');
    let certificate: EfiCertificate;
    try {
      if (file.size > CERTIFICATE_MAX_BYTES) throw new Error();
      certificate = inspectEfiCertificate(
        file.buffer.toString('base64'),
        dto.certificatePassword ?? '',
      );
    } catch {
      this.fail(422, 'CERTIFICATE_INVALID');
    } finally {
      file.buffer.fill(0);
    }

    await this.prisma.$transaction(async (tx) => {
      const profile = await this.lockOpenCandidate(
        tx,
        id,
        dto.expectedRevision,
      );
      if (profile.accountMode !== 'CUSTOMER_ACCOUNT')
        this.fail(422, 'CREDENTIALS_NOT_ACCEPTED');
      const company = await tx.company.findUniqueOrThrow({
        where: { id: profile.companyId },
        select: { document: true },
      });
      if (dto.holderDocument !== company.document)
        this.fail(422, 'ACCOUNT_OWNERSHIP_UNVERIFIED');
      const { identity, credential } =
        await this.registry.registerCompanyCredential(tx, {
          companyId: profile.companyId,
          environment: profile.environment,
          holderDocument: dto.holderDocument,
          efiAccountNumber: dto.efiAccountNumber,
          efiAccountDigit: dto.efiAccountDigit,
          payeeCode: dto.payeeCode,
          pixKey: dto.pixKey,
          clientId: dto.clientId,
          clientSecret: dto.clientSecret,
          certificate,
          userId,
        });
      const identityChanged = profile.issuerIdentityId !== identity.id;
      await this.bumpRevision(tx, profile, {
        issuerIdentityId: identity.id,
        issuerCredentialVersionId: credential.id,
        // A different account needs a new ownership attestation.
        ...(identityChanged
          ? { ownershipVerifiedAt: null, ownershipVerifiedByUserId: null }
          : {}),
      });
      if (profile.issuerCredentialVersionId)
        await this.registry.rejectCandidateCredential(
          tx,
          profile.issuerCredentialVersionId,
        );
      await this.audit(
        tx,
        profile,
        userId,
        'FINANCIAL_ACTIVATION_CREDENTIALS_UPLOADED',
        {
          identityId: identity.id,
          efiAccountNumber: mask(identity.efiAccountNumber),
          credentialVersion: credential.version,
          certificateFingerprint: credential.certificateFingerprint,
          certificateExpiresAt: credential.certificateExpiresAt,
          ownershipReset: identityChanged,
        },
      );
    });
    return this.getActivation(id);
  }

  async cancel(
    id: string,
    userId: string,
    dto: CancelFinancialActivationDto,
  ): Promise<FinancialProfileView> {
    await this.prisma.$transaction(async (tx) => {
      const profile = await this.lockOpenCandidate(
        tx,
        id,
        dto.expectedRevision,
      );
      await tx.financialProfileVersion.update({
        where: { id: profile.id },
        data: {
          status: 'CANCELED',
          canceledAt: new Date(),
          cancelReason: dto.reason.trim(),
        },
      });
      if (profile.issuerCredentialVersionId)
        await this.registry.rejectCandidateCredential(
          tx,
          profile.issuerCredentialVersionId,
        );
      await this.audit(tx, profile, userId, 'FINANCIAL_ACTIVATION_CANCELED', {
        reason: dto.reason.trim(),
      });
    });
    return this.getActivation(id);
  }

  @Cron('0 20 3 * * *')
  async expireAbandonedCandidatesJob(): Promise<void> {
    try {
      await this.expireAbandonedCandidates();
    } catch {
      this.logger.error('FINANCIAL_CANDIDATE_EXPIRY_FAILED');
    }
  }

  // Candidates untouched for the retention period expire and their secrets are wiped.
  async expireAbandonedCandidates(now = new Date()): Promise<number> {
    const cutoff = new Date(
      now.getTime() - CANDIDATE_RETENTION_DAYS * 86400_000,
    );
    const stale = await this.prisma.financialProfileVersion.findMany({
      where: {
        status: { in: OPEN_CANDIDATE_STATUSES },
        updatedAt: { lt: cutoff },
      },
      select: { id: true },
      take: 500,
    });
    let expired = 0;
    for (const { id } of stale) {
      await this.prisma.$transaction(async (tx) => {
        const profile = await tx.financialProfileVersion.findUnique({
          where: { id },
        });
        if (!profile) return;
        const claimed = await tx.financialProfileVersion.updateMany({
          where: {
            id,
            revision: profile.revision,
            status: { in: OPEN_CANDIDATE_STATUSES },
            updatedAt: { lt: cutoff },
          },
          data: { status: 'EXPIRED' },
        });
        if (claimed.count !== 1) return;
        if (profile.issuerCredentialVersionId)
          await this.registry.rejectCandidateCredential(
            tx,
            profile.issuerCredentialVersionId,
          );
        await this.audit(tx, profile, null, 'FINANCIAL_ACTIVATION_EXPIRED', {
          retentionDays: CANDIDATE_RETENTION_DAYS,
        });
        expired++;
      });
    }
    return expired;
  }

  private async lockOpenCandidate(
    tx: Prisma.TransactionClient,
    id: string,
    expectedRevision: number,
  ): Promise<FinancialProfileVersion> {
    const locked = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM "FinancialProfileVersion" WHERE id=${id} FOR UPDATE`,
    );
    if (locked.length === 0) this.fail(404, 'FINANCIAL_ACTIVATION_NOT_FOUND');
    const profile = await tx.financialProfileVersion.findUniqueOrThrow({
      where: { id },
    });
    if (!OPEN_CANDIDATE_STATUSES.includes(profile.status))
      this.fail(409, 'FINANCIAL_ACTIVATION_CLOSED');
    if (profile.revision !== expectedRevision)
      this.fail(409, 'REVISION_CONFLICT');
    return profile;
  }

  // Every edit creates a new revision and voids any previous validation.
  private async bumpRevision(
    tx: Prisma.TransactionClient,
    profile: FinancialProfileVersion,
    data: Prisma.FinancialProfileVersionUncheckedUpdateManyInput,
  ): Promise<void> {
    const updated = await tx.financialProfileVersion.updateMany({
      where: {
        id: profile.id,
        revision: profile.revision,
        status: { in: OPEN_CANDIDATE_STATUSES },
      },
      data: {
        ...data,
        revision: profile.revision + 1,
        status: 'DRAFT',
        validatedAt: null,
        validationHash: null,
      },
    });
    if (updated.count !== 1) this.fail(409, 'REVISION_CONFLICT');
  }

  private async audit(
    tx: Prisma.TransactionClient,
    profile: Pick<FinancialProfileVersion, 'id' | 'companyId'>,
    userId: string | null,
    action: string,
    changes: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        companyId: profile.companyId,
        userId,
        entityType: 'FinancialProfileVersion',
        entityId: profile.id,
        action,
        changes: changes as Prisma.InputJsonValue,
        retentionExpiresAt: new Date(Date.now() + AUDIT_RETENTION_MS),
      },
    });
  }

  private toView(profile: ProfileWithIssuer): FinancialProfileView {
    const identity = profile.issuerIdentity;
    const credential = profile.issuerCredentialVersion;
    return {
      id: profile.id,
      companyId: profile.companyId,
      version: profile.version,
      revision: profile.revision,
      status: profile.status,
      origin: profile.origin,
      accountMode: profile.accountMode,
      payoutMode: profile.payoutMode,
      environment: profile.environment,
      enabledMethods: profile.enabledMethods,
      authorization: {
        kind: profile.authorizationKind,
        reference: profile.authorizationReference,
        validUntil: profile.authorizationValidUntil,
      },
      ownership: {
        verifiedAt: profile.ownershipVerifiedAt,
        verifiedByUserId: profile.ownershipVerifiedByUserId,
        evidenceReference: profile.ownershipEvidenceReference,
      },
      issuer: identity
        ? {
            id: identity.id,
            ownership: identity.ownership,
            holderDocument: mask(identity.holderDocument),
            efiAccountNumber: mask(identity.efiAccountNumber),
            payeeCode: identity.payeeCode ? mask(identity.payeeCode) : null,
            pixKey: identity.pixKey ? mask(identity.pixKey) : null,
          }
        : null,
      credential: credential
        ? {
            version: credential.version,
            status: credential.status,
            certificateFingerprint: credential.certificateFingerprint,
            certificateExpiresAt: credential.certificateExpiresAt,
          }
        : null,
      validatedAt: profile.validatedAt,
      activatedAt: profile.activatedAt,
      supersededAt: profile.supersededAt,
      canceledAt: profile.canceledAt,
      cancelReason: profile.cancelReason,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  private fail(status: number, code: string): never {
    throw new HttpException({ code, message: MESSAGES[code] ?? code }, status);
  }
}

export function mask(value: string): string {
  return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}

const MESSAGES: Record<string, string> = {
  COMPANY_NOT_FOUND: 'Empresa não encontrada.',
  FINANCIAL_ACTIVATION_NOT_FOUND: 'Ativação financeira não encontrada.',
  FINANCIAL_MODE_INVALID: 'Combinação de conta e repasse inválida.',
  FINANCIAL_MODE_NOT_AVAILABLE:
    'A cobrança pela conta CifraMais ainda não está disponível.',
  IDEMPOTENCY_KEY_REUSED:
    'Esta chave de requisição já foi usada com outros dados.',
  CANDIDATE_ALREADY_OPEN:
    'Já existe uma ativação em preparação para esta empresa.',
  FINANCIAL_ACTIVATION_CLOSED: 'Esta ativação não pode mais ser alterada.',
  REVISION_CONFLICT:
    'A ativação foi alterada por outra pessoa. Recarregue antes de continuar.',
  AUTHORIZATION_EXPIRED: 'A validade da autorização já passou.',
  OWNERSHIP_EVIDENCE_REQUIRED:
    'Informe a referência da evidência de titularidade.',
  ACCOUNT_OWNERSHIP_UNVERIFIED:
    'O titular da conta não corresponde ao documento da empresa.',
  NOTHING_TO_UPDATE: 'Nenhuma alteração informada.',
  CERTIFICATE_REQUIRED: 'Envie o certificado .p12.',
  CERTIFICATE_INVALID:
    'Certificado inválido, expirado, com senha incorreta ou maior que 1 MiB.',
  CREDENTIALS_NOT_ACCEPTED:
    'Este modo usa a integração da plataforma e não recebe credenciais da empresa.',
};
