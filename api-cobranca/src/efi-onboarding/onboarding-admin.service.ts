import { HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PlatformIntegration } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { inspectEfiCertificate } from '../payment/efi-certificate';
import { GatewayHealthService } from '../payment/gateway-health.service';
import { EfiOpeningClient } from './efi-opening.client';
import { OnboardingJobs } from './onboarding-jobs';
import { readCheckpoint } from './onboarding-checkpoint';

const SAFE_ONBOARDING = {
  companyId: true,
  status: true,
  draftRevision: true,
  simplifiedAccountRequestId: true,
  submissionAttempts: true,
  provisioningAttempts: true,
  reminderAttempts: true,
  noticeAttempts: true,
  noticeAcceptedAt: true,
  submittedAt: true,
  activatedAt: true,
  lastProgressAt: true,
  refusalAt: true,
  retryBlockedUntil: true,
  sanitizedErrorCode: true,
  sanitizedErrorMessage: true,
  consentAcceptedAt: true,
  authorizationTextVersion: true,
  termsVersion: true,
  privacyPolicyVersion: true,
} satisfies Prisma.EfiOnboardingSelect;
const SAFE_GATEWAY = {
  status: true,
  environment: true,
  healthStatus: true,
  certificateExpiresAt: true,
  lastValidatedAt: true,
  consecutiveFailures: true,
  lastError: true,
} satisfies Prisma.GatewayAccountSelect;

@Injectable()
export class OnboardingAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PaymentCryptoService,
    private readonly config: ConfigService,
    private readonly client: EfiOpeningClient,
    private readonly jobs: OnboardingJobs,
    private readonly health: GatewayHealthService,
  ) {}
  async list(page = 1): Promise<unknown> {
    const where = {};
    const [items, total] = await Promise.all([
      this.prisma.efiOnboarding.findMany({
        where,
        select: {
          ...SAFE_ONBOARDING,
          company: {
            select: { corporateName: true, tradeName: true, document: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 50,
        skip: (page - 1) * 50,
      }),
      this.prisma.efiOnboarding.count({ where }),
    ]);
    return { items, total, page, pageSize: 50 };
  }
  async detail(companyId: string): Promise<unknown> {
    const [onboarding, gateway, timeline] = await Promise.all([
      this.prisma.efiOnboarding.findUnique({
        where: { companyId },
        select: SAFE_ONBOARDING,
      }),
      this.prisma.gatewayAccount.findUnique({
        where: { companyId },
        select: SAFE_GATEWAY,
      }),
      this.prisma.auditLog.findMany({
        where: { companyId, entityType: 'EfiOnboarding' },
        select: { action: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);
    return { onboarding, gateway, timeline };
  }
  async retry(companyId: string, userId: string): Promise<unknown> {
    const row = await this.prisma.efiOnboarding.findUnique({
      where: { companyId },
    });
    if (
      !row ||
      row.status !== 'CONFIGURATION_ERROR' ||
      !row.simplifiedAccountRequestId
    )
      this.fail('EFI_PROVISIONING_NOT_RETRYABLE');
    const checkpoint = readCheckpoint(row.provisioningCheckpoint);
    delete checkpoint.provisionRetryAt;
    await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient): Promise<void> => {
        const claimed = await tx.efiOnboarding.updateMany({
          where: {
            companyId,
            status: 'CONFIGURATION_ERROR',
            draftRevision: row.draftRevision,
          },
          data: {
            status: 'PROVISIONING',
            provisioningAttempts: 0,
            provisioningCheckpoint: checkpoint,
            adminAlertedAt: null,
            lastProgressAt: new Date(),
          },
        });
        if (claimed.count !== 1) this.fail('ONBOARDING_LOCKED');
        await tx.auditLog.create({
          data: {
            companyId,
            userId,
            entityType: 'EfiOnboarding',
            entityId: row.id,
            action: 'EFI_ADMIN_RETRY_PROVISIONING',
            retentionExpiresAt: new Date(Date.now() + 5 * 365.25 * 86400_000),
          },
        });
      },
    );
    await this.jobs.schedule(
      companyId,
      'provision',
      row.draftRevision * 100 + 1,
      60_000,
      true,
    );
    return this.detail(companyId);
  }
  async manual(
    companyId: string,
    userId: string,
    input: {
      requestId: string;
      ownershipVerified?: boolean;
      verifiedCompanyDocument?: string;
      certificateBase64?: string;
      certificatePassword?: string;
    },
  ): Promise<unknown> {
    const row = await this.prisma.efiOnboarding.findUnique({
      where: { companyId },
      include: { company: true },
    });
    if (
      !row ||
      !['SUBMISSION_UNCERTAIN', 'CONFIGURATION_ERROR', 'ACTIVE'].includes(
        row.status,
      ) ||
      !row.submittedCompanyDocument ||
      row.company.document !== row.submittedCompanyDocument
    )
      this.fail('EFI_MANUAL_NOT_ALLOWED');
    if (row.status === 'ACTIVE' && !input.certificateBase64)
      this.fail('EFI_CERTIFICATE_REQUIRED');
    if (
      row.simplifiedAccountRequestId &&
      row.simplifiedAccountRequestId !== input.requestId
    )
      this.fail('EFI_REQUEST_MISMATCH');
    // The public credential response does not contain the owner's CNPJ.
    // An unbound request therefore requires an explicit, attributable portal check.
    if (
      !row.simplifiedAccountRequestId &&
      (input.ownershipVerified !== true ||
        input.verifiedCompanyDocument !== row.submittedCompanyDocument)
    )
      this.fail('EFI_OWNERSHIP_VERIFICATION_REQUIRED');
    const credentials = await this.client.getCredentials(input.requestId);
    if (!credentials.active) this.fail('EFI_ACCOUNT_NOT_ACTIVE');
    const certificate = input.certificateBase64
      ? inspectEfiCertificate(
          input.certificateBase64,
          input.certificatePassword,
        )
      : null;
    await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient): Promise<void> => {
        const claimed = await tx.efiOnboarding.updateMany({
          where: {
            companyId,
            status: row.status,
            draftRevision: row.draftRevision,
          },
          data: {
            status: 'CONFIGURATION_ERROR',
            simplifiedAccountRequestId: input.requestId,
          },
        });
        if (claimed.count !== 1) this.fail('ONBOARDING_LOCKED');
        if (certificate) {
          const data = {
            status: 'PENDING',
            payeeCode: credentials.payeeCode,
            efiAccountNumber: credentials.accountNumber,
            efiAccountDigit: credentials.accountDigit,
            encryptedClientId: this.crypto.encrypt(credentials.clientId),
            encryptedClientSecret: this.crypto.encrypt(
              credentials.clientSecret,
            ),
            encryptedCertificate: this.crypto.encrypt(certificate.base64),
            certificatePath: null,
            encryptedCertificatePassword: null,
            certificateExpiresAt: certificate.expiresAt,
            certificateFingerprint: certificate.fingerprint,
            credentialKeyVersion: this.crypto.activeKeyVersion,
          };
          await tx.gatewayAccount.upsert({
            where: { companyId },
            create: {
              companyId,
              ...data,
              pixKey: '',
              environment: this.config.get<string>('EFI_ENV') ?? 'homologation',
            },
            update: data,
          });
        }
        await tx.auditLog.create({
          data: {
            companyId,
            userId,
            entityType: 'EfiOnboarding',
            entityId: row.id,
            action: 'EFI_ADMIN_MANUAL_RECOVERY',
            changes: {
              requestId: input.requestId,
              certificateSupplied: Boolean(certificate),
              ...(!row.simplifiedAccountRequestId
                ? {
                    ownershipVerification: 'ADMIN_EFI_PORTAL_ATTESTATION',
                    verifiedCompanyDocument: input.verifiedCompanyDocument,
                  }
                : {}),
            },
            retentionExpiresAt: new Date(Date.now() + 5 * 365.25 * 86400_000),
          },
        });
      },
    );
    return this.retry(companyId, userId);
  }
  async setEnabled(
    integration: PlatformIntegration,
    enabled: boolean,
  ): Promise<unknown> {
    if (enabled && integration === 'EFI_ONBOARDING') {
      // A production Node server can use Efi homologation. Only an explicit
      // homologation environment is exempt from the production approval gate.
      if (
        this.config.get<string>('EFI_ENV') !== 'homologation' &&
        this.config.get<string>('EFI_LEGAL_APPROVED') !== 'true'
      )
        this.fail(
          'EFI_LEGAL_APPROVAL_REQUIRED',
          'Novas ativações em produção exigem aprovação dos textos de autorização, termos de uso e política de privacidade.',
        );
      const url = new URL(
        this.config.get<string>('EFI_WEBHOOK_BASE_URL') ?? '',
      );
      if (url.protocol !== 'https:') this.fail('EFI_WEBHOOK_URL_INVALID');
      await this.client.registerWebhook(
        `${url.origin}/webhooks/efi/account-opening`,
      );
    }
    return this.prisma.platformIntegrationState.upsert({
      where: { integration },
      create: { integration, enabled, pausedAt: enabled ? null : new Date() },
      update: {
        enabled,
        pausedAt: enabled ? null : new Date(),
        pauseReason: enabled ? null : 'ADMIN_PAUSED',
      },
    });
  }
  async integrationHealth(): Promise<unknown> {
    const rows = await this.prisma.platformIntegrationState.findMany();
    return Object.values(PlatformIntegration).map((integration) => ({
      integration,
      enabled:
        rows.find((row) => row.integration === integration)?.enabled ??
        (integration === 'META' || integration === 'RESEND'),
      healthStatus:
        rows.find((row) => row.integration === integration)?.healthStatus ??
        'UNKNOWN',
      lastCheckedAt:
        rows.find((row) => row.integration === integration)?.lastCheckedAt ??
        null,
    }));
  }
  async validate(companyId: string): Promise<unknown> {
    await this.health.validate(companyId);
    return this.detail(companyId);
  }
  private fail(
    code: string,
    message: string = 'A operação exige revisão dos dados no painel administrativo.',
  ): never {
    throw new HttpException(
      {
        code,
        message,
      },
      409,
    );
  }
}
