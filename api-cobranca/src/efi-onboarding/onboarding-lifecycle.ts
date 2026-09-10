import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { EfiGatewayClient } from '../payment/efi-gateway.client';
import { GatewayHealthService } from '../payment/gateway-health.service';
import { inspectEfiCertificate } from '../payment/efi-certificate';
import { EfiOpeningClient } from './efi-opening.client';
import { OnboardingNotifications } from './onboarding-notifications';
import { readCheckpoint } from './onboarding-checkpoint';

@Injectable()
export class OnboardingLifecycle {
  private readonly logger = new Logger(OnboardingLifecycle.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PaymentCryptoService,
    private readonly opening: EfiOpeningClient,
    private readonly gateway: EfiGatewayClient,
    private readonly health: GatewayHealthService,
    private readonly notifications: OnboardingNotifications,
  ) {}
  @Cron('0 0 3 * * *')
  async certificates(): Promise<void> {
    let cursor: string | undefined;
    do {
      const accounts = await this.prisma.gatewayAccount.findMany({
        where: {
          status: 'ACTIVE',
          certificateExpiresAt: { lte: new Date(Date.now() + 30 * 86400_000) },
        },
        orderBy: { id: 'asc' },
        take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const account of accounts) {
        try {
          await this.renew(account.companyId);
        } catch {
          this.logger.error('EFI_CERTIFICATE_MAINTENANCE_FAILED');
        }
      }
      cursor = accounts.length === 100 ? accounts.at(-1)?.id : undefined;
    } while (cursor);
  }
  async renew(companyId: string): Promise<void> {
    const [row, account] = await Promise.all([
      this.prisma.efiOnboarding.findUnique({ where: { companyId } }),
      this.prisma.gatewayAccount.findUnique({ where: { companyId } }),
    ]);
    if (
      !row ||
      row.status !== 'ACTIVE' ||
      !row.simplifiedAccountRequestId ||
      !account?.certificateExpiresAt
    )
      return;
    const days = Math.ceil(
      (account.certificateExpiresAt.getTime() - Date.now()) / 86400_000,
    );
    if (days > 30) return;
    const checkpoint = readCheckpoint(row.provisioningCheckpoint);
    const threshold = days <= 7 ? 7 : days <= 15 ? 15 : 30;
    const alertKey = `certificateAlert${threshold}`;
    if (checkpoint[alertKey] !== account.certificateFingerprint) {
      await this.notifications.alert(
        companyId,
        `EFI_CERTIFICATE_EXPIRES_${threshold}_DAYS`,
      );
      checkpoint[alertKey] = account.certificateFingerprint;
      await this.prisma.efiOnboarding.updateMany({
        where: { companyId, status: 'ACTIVE' },
        data: { provisioningCheckpoint: checkpoint },
      });
    }
    if (checkpoint.renewalRequestedFor === account.certificateFingerprint)
      return;
    const current = await this.prisma.efiOnboarding.findUnique({
      where: { companyId },
      select: { updatedAt: true, provisioningCheckpoint: true },
    });
    if (
      !current ||
      readCheckpoint(current.provisioningCheckpoint).renewalRequestedFor ===
        account.certificateFingerprint
    )
      return;
    const claimed = await this.prisma.efiOnboarding.updateMany({
      where: { companyId, status: 'ACTIVE', updatedAt: current.updatedAt },
      data: {
        provisioningCheckpoint: {
          ...checkpoint,
          renewalRequestedFor: account.certificateFingerprint,
        },
      },
    });
    if (claimed.count !== 1) return;
    try {
      const certificate = inspectEfiCertificate(
        await this.opening.createCertificate(row.simplifiedAccountRequestId),
      );
      if (certificate.expiresAt <= account.certificateExpiresAt)
        throw new Error('EFI_RENEWAL_NOT_EXTENDED');
      // Persist the new certificate before another network call can fail; creation cannot be replayed.
      const candidate = {
        ...account,
        encryptedCertificate: this.crypto.encrypt(certificate.base64),
        certificateExpiresAt: certificate.expiresAt,
        certificateFingerprint: certificate.fingerprint,
      };
      await this.prisma.gatewayAccount.update({
        where: { companyId },
        data: {
          encryptedCertificate: candidate.encryptedCertificate,
          certificateExpiresAt: certificate.expiresAt,
          certificateFingerprint: certificate.fingerprint,
          credentialKeyVersion: this.crypto.activeKeyVersion,
          lastError: null,
        },
      });
      await this.health.validate(companyId);
    } catch {
      await this.notifications.alert(
        companyId,
        'EFI_CERTIFICATE_RENEWAL_REQUIRES_REVIEW',
      );
      // No automatic second POST after an ambiguous certificate creation.
    }
  }
  async disconnect(companyId: string, userId: string): Promise<void> {
    const account = await this.prisma.gatewayAccount.findUnique({
      where: { companyId },
    });
    let removalFailed = false;
    try {
      if (account?.pixKey && account.encryptedCertificate)
        await this.gateway.removeWebhook(account);
    } catch {
      removalFailed = true;
    }
    await this.prisma.$transaction(async (tx): Promise<void> => {
      if (account)
        await tx.gatewayAccount.update({
          where: { companyId },
          data: {
            status: 'DISABLED',
            healthStatus: 'UNAVAILABLE',
            encryptedClientId: '',
            encryptedClientSecret: '',
            encryptedCertificate: null,
            encryptedCertificatePassword: null,
            certificatePath: null,
            pixKey: '',
            lastError: removalFailed ? 'EFI_WEBHOOK_REMOVAL_REQUIRED' : null,
          },
        });
      await tx.efiOnboarding.updateMany({
        where: { companyId },
        data: {
          status: 'DISCONNECTED',
          disconnectedAt: new Date(),
          representativeNameEncrypted: null,
          representativeCpfEncrypted: null,
          representativeBirthDateEncrypted: null,
          representativeMotherNameEncrypted: null,
          representativeEmailEncrypted: null,
          representativePhoneEncrypted: null,
          sensitiveDataDeletedAt: new Date(),
          sensitiveDataKeyVersion: null,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId,
          userId,
          entityType: 'EfiOnboarding',
          entityId: companyId,
          action: 'EFI_INTEGRATION_DISCONNECTED',
          retentionExpiresAt: new Date(Date.now() + 5 * 365.25 * 86400_000),
        },
      });
    });
    if (removalFailed)
      await this.notifications.alert(companyId, 'EFI_WEBHOOK_REMOVAL_REQUIRED');
  }
}
