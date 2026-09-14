import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { EfiGatewayClient } from '../payment/efi-gateway.client';
import { inspectEfiCertificate } from '../payment/efi-certificate';
import { GatewayAccount, Prisma } from '@prisma/client';
import { EfiOpeningClient, EFI_REQUIRED_SCOPES } from './efi-opening.client';
import { OnboardingJobs } from './onboarding-jobs';
import { OnboardingNotifications } from './onboarding-notifications';
import { readCheckpoint } from './onboarding-checkpoint';

const DELAYS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000];
interface ProvisionLease {
  companyId: string;
  revision: number;
  attempt: number;
}
class ProvisioningError extends Error {
  constructor(
    readonly code: string,
    readonly terminal = false,
  ) {
    super(code);
  }
}

@Injectable()
export class OnboardingProvisioner {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PaymentCryptoService,
    private readonly config: ConfigService,
    private readonly opening: EfiOpeningClient,
    private readonly gateway: EfiGatewayClient,
    private readonly jobs: OnboardingJobs,
    private readonly notifications: OnboardingNotifications,
  ) {}
  async run(companyId: string, attempt: number): Promise<void> {
    const row = await this.prisma.efiOnboarding.findUnique({
      where: { companyId },
      include: { company: true },
    });
    const index = attempt % 100;
    if (
      !row ||
      row.status !== 'PROVISIONING' ||
      row.draftRevision !== Math.floor(attempt / 100) ||
      index !== row.provisioningAttempts + 1 ||
      index > 5
    )
      return;
    const checkpoint = readCheckpoint(row.provisioningCheckpoint);
    if (
      typeof checkpoint.provisionRetryAt === 'string' &&
      Date.parse(checkpoint.provisionRetryAt) > Date.now()
    )
      return;
    const lease = new Date(Date.now() + 15 * 60_000).toISOString();
    const claimed = await this.prisma.efiOnboarding.updateMany({
      where: {
        companyId,
        status: 'PROVISIONING',
        draftRevision: row.draftRevision,
        provisioningAttempts: index - 1,
      },
      data: {
        provisioningAttempts: index,
        provisioningCheckpoint: { ...checkpoint, provisionRetryAt: lease },
      },
    });
    if (claimed.count !== 1) return;
    checkpoint.provisionRetryAt = lease;
    const owner: ProvisionLease = {
      companyId,
      revision: row.draftRevision,
      attempt: index,
    };
    let provisionedAccount: GatewayAccount | null = null;
    try {
      if (
        !row.simplifiedAccountRequestId ||
        row.submittedCompanyDocument !== row.company.document
      )
        throw new ProvisioningError('EFI_COMPANY_MISMATCH', true);
      const credentials = await this.opening.getCredentials(
        row.simplifiedAccountRequestId,
      );
      if (
        !credentials.active ||
        !EFI_REQUIRED_SCOPES.every((scope): boolean =>
          credentials.scopes.includes(scope),
        )
      )
        throw new ProvisioningError('EFI_CREDENTIALS_INCOMPLETE');
      // The provider binds these credentials to the submitted request; its public response has no independent CNPJ field.
      const data = {
        provider: 'EFI',
        environment: this.config.get<string>('EFI_ENV') ?? 'homologation',
        status: 'PENDING',
        payeeCode: credentials.payeeCode,
        efiAccountNumber: credentials.accountNumber,
        efiAccountDigit: credentials.accountDigit,
        encryptedClientId: this.crypto.encrypt(credentials.clientId),
        encryptedClientSecret: this.crypto.encrypt(credentials.clientSecret),
        credentialKeyVersion: this.crypto.activeKeyVersion,
      };
      let account = await this.withLease(owner, (tx) =>
        tx.gatewayAccount.upsert({
          where: { companyId },
          create: { companyId, ...data, pixKey: '' },
          update: data,
        }),
      );
      provisionedAccount = account;
      if (!account.encryptedCertificate) {
        if (checkpoint.certificateRequested)
          throw new ProvisioningError('EFI_CERTIFICATE_UNCERTAIN', true);
        checkpoint.certificateRequested = true;
        await this.checkpoint(owner, checkpoint);
        const base64 = await this.opening.createCertificate(
          row.simplifiedAccountRequestId,
        );
        const certificate = inspectEfiCertificate(base64);
        account = await this.withLease(owner, (tx) =>
          tx.gatewayAccount.update({
            where: { companyId },
            data: {
              encryptedCertificate: this.crypto.encrypt(certificate.base64),
              certificatePath: null,
              encryptedCertificatePassword: null,
              certificateExpiresAt: certificate.expiresAt,
              certificateFingerprint: certificate.fingerprint,
            },
          }),
        );
        provisionedAccount = account;
      } else {
        inspectEfiCertificate(
          this.crypto.decrypt(account.encryptedCertificate),
        );
      }
      account = await this.ensureEvp(account, checkpoint, owner);
      provisionedAccount = account;
      await this.checkpoint(owner, checkpoint);
      await this.gateway.configureWebhooks(account);
      checkpoint.webhooksConfigured = true;
      await this.checkpoint(owner, checkpoint);
      await this.gateway.validate(account);
      await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient): Promise<void> => {
          const transitioned = await tx.efiOnboarding.updateMany({
            where: {
              companyId,
              status: 'PROVISIONING',
              draftRevision: row.draftRevision,
              provisioningAttempts: index,
            },
            data: {
              status: 'ACTIVE',
              activatedAt: new Date(),
              lastProgressAt: new Date(),
              sanitizedErrorCode: null,
              sanitizedErrorMessage: null,
              provisioningCheckpoint: { validated: true },
              representativeNameEncrypted: null,
              representativeCpfEncrypted: null,
              representativeBirthDateEncrypted: null,
              representativeMotherNameEncrypted: null,
              representativeEmailEncrypted: null,
              representativePhoneEncrypted: null,
              sensitiveDataKeyVersion: null,
              sensitiveDataDeletedAt: new Date(),
            },
          });
          if (transitioned.count !== 1)
            throw new ProvisioningError('EFI_PROVISIONING_STALE', true);
          await tx.gatewayAccount.update({
            where: { companyId },
            data: {
              status: 'ACTIVE',
              healthStatus: 'HEALTHY',
              consecutiveFailures: 0,
              lastValidatedAt: new Date(),
              lastError: null,
            },
          });
          await tx.auditLog.create({
            data: {
              companyId,
              entityId: row.id,
              entityType: 'EfiOnboarding',
              action: 'EFI_ACCOUNT_ACTIVATED',
              retentionExpiresAt: new Date(Date.now() + 5 * 365.25 * 86400_000),
            },
          });
        },
      );
    } catch (error: unknown) {
      const latest = await this.prisma.efiOnboarding.findUnique({
        where: { companyId },
        select: { status: true },
      });
      if (latest?.status === 'DISCONNECTED') {
        if (
          provisionedAccount?.pixKey &&
          provisionedAccount.encryptedCertificate
        ) {
          try {
            await this.gateway.removeWebhook(provisionedAccount);
          } catch {
            await this.notifications.alert(
              companyId,
              'EFI_WEBHOOK_REMOVAL_REQUIRED',
            );
          }
        }
        return;
      }
      const code =
        error instanceof ProvisioningError
          ? error.code
          : 'EFI_PROVISIONING_FAILED';
      const terminal =
        index >= 5 || (error instanceof ProvisioningError && error.terminal);
      const delay = DELAYS[index] ?? 0;
      checkpoint.provisionRetryAt = new Date(Date.now() + delay).toISOString();
      await this.prisma.efiOnboarding.updateMany({
        where: {
          companyId,
          status: 'PROVISIONING',
          draftRevision: row.draftRevision,
          provisioningAttempts: index,
        },
        data: {
          status: terminal ? 'CONFIGURATION_ERROR' : 'PROVISIONING',
          sanitizedErrorCode: code,
          sanitizedErrorMessage:
            'A configuração financeira requer validação da CifraMais.',
          provisioningCheckpoint: checkpoint,
        },
      });
      if (terminal) await this.notifications.alert(companyId, code);
      else
        await this.jobs.schedule(
          companyId,
          'provision',
          row.draftRevision * 100 + index + 1,
          delay,
        );
    }
  }

  private async ensureEvp(
    account: GatewayAccount,
    checkpoint: Prisma.JsonObject,
    owner: ProvisionLease,
  ): Promise<GatewayAccount> {
    if (account.pixKey) return account;
    let key: string | undefined;
    if (checkpoint.evpRequested) {
      const before = Array.isArray(checkpoint.evpBefore)
        ? checkpoint.evpBefore.filter(
            (value): value is string => typeof value === 'string',
          )
        : [];
      const delta = (await this.gateway.listEvp(account)).filter(
        (value): boolean => !before.includes(value),
      );
      if (delta.length !== 1)
        throw new ProvisioningError('EFI_EVP_UNCERTAIN', true);
      key = delta[0];
    } else {
      checkpoint.evpBefore = await this.gateway.listEvp(account);
      checkpoint.evpRequested = true;
      await this.checkpoint(owner, checkpoint);
      key = await this.gateway.createEvp(account);
    }
    if (!key || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(key))
      throw new ProvisioningError('EFI_EVP_INVALID', true);
    // Global uniqueness check is an internal financial invariant, never a tenant-visible lookup.
    const keyOwner = await this.prisma.gatewayAccount.findFirst({
      where: { pixKey: key, companyId: { not: account.companyId } },
      select: { id: true },
    });
    if (keyOwner) throw new ProvisioningError('EFI_EVP_ALREADY_BOUND', true);
    return this.withLease(owner, (tx) =>
      tx.gatewayAccount.update({
        where: { companyId: account.companyId },
        data: { pixKey: key },
      }),
    );
  }

  private async withLease<T>(
    owner: ProvisionLease,
    action: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx: Prisma.TransactionClient): Promise<T> => {
        // Lock the onboarding row before touching secrets, using the same order as disconnect.
        const claimed = await tx.efiOnboarding.updateMany({
          where: {
            companyId: owner.companyId,
            status: 'PROVISIONING',
            draftRevision: owner.revision,
            provisioningAttempts: owner.attempt,
          },
          data: { lastProgressAt: new Date() },
        });
        if (claimed.count !== 1)
          throw new ProvisioningError('EFI_PROVISIONING_STALE', true);
        return action(tx);
      },
    );
  }
  private async checkpoint(
    owner: ProvisionLease,
    data: Prisma.JsonObject,
  ): Promise<void> {
    await this.withLease(owner, async (tx): Promise<void> => {
      await tx.efiOnboarding.updateMany({
        where: { companyId: owner.companyId, status: 'PROVISIONING' },
        data: { provisioningCheckpoint: data },
      });
    });
  }
}
