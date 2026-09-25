import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BillingMethod, IntegrationHealthStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialEligibilityService } from '../financial-activation/financial-eligibility.service';
import { EfiGatewayClient } from './efi-gateway.client';

@Injectable()
export class GatewayHealthService {
  private readonly logger = new Logger(GatewayHealthService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: EfiGatewayClient,
    private readonly eligibility: FinancialEligibilityService,
  ) {}
  // Eligibility follows the published financial profile (manual or opening).
  // Provider health comes from the scheduled validation, not from a live
  // round-trip on every issuance.
  async assertIssuable(
    companyId: string,
    method?: BillingMethod,
  ): Promise<void> {
    await this.eligibility.resolveIssuance(companyId, method);
  }
  async validate(companyId: string): Promise<boolean> {
    const account = await this.prisma.gatewayAccount.findUnique({
      where: { companyId },
    });
    if (!account || account.status !== 'ACTIVE') return false;
    try {
      if (
        !account.certificateExpiresAt ||
        account.certificateExpiresAt.getTime() <= Date.now()
      )
        throw new Error('EFI_CERTIFICATE_EXPIRED');
      await this.client.validate(account);
      await this.prisma.gatewayAccount.update({
        where: { companyId },
        data: {
          healthStatus: 'HEALTHY',
          consecutiveFailures: 0,
          lastValidatedAt: new Date(),
          lastError: null,
        },
      });
      await this.mirrorIdentityHealth(account.efiAccountIdentityId, 'HEALTHY');
      return true;
    } catch {
      const failed = await this.prisma.gatewayAccount.update({
        where: { companyId },
        data: {
          consecutiveFailures: { increment: 1 },
          lastValidatedAt: new Date(),
          lastError: 'EFI_VALIDATION_FAILED',
          healthStatus: 'DEGRADED',
        },
      });
      const status: IntegrationHealthStatus =
        failed.consecutiveFailures >= 2 ? 'UNAVAILABLE' : 'DEGRADED';
      if (status === 'UNAVAILABLE')
        await this.prisma.gatewayAccount.update({
          where: { companyId },
          data: { healthStatus: 'UNAVAILABLE' },
        });
      await this.mirrorIdentityHealth(account.efiAccountIdentityId, status);
      return false;
    }
  }
  @Cron('0 0 */6 * * *')
  async validateAll(): Promise<void> {
    let cursor: string | undefined;
    do {
      const accounts = await this.prisma.gatewayAccount.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { id: 'asc' },
        take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const account of accounts) {
        try {
          await this.validate(account.companyId);
        } catch {
          this.logger.error('EFI_HEALTH_CHECK_FAILED');
        }
      }
      cursor = accounts.length === 100 ? accounts.at(-1)?.id : undefined;
    } while (cursor);
  }
  // Eligibility reads the identity, the stable account the profile points to.
  private async mirrorIdentityHealth(
    identityId: string | null,
    healthStatus: IntegrationHealthStatus,
  ): Promise<void> {
    if (!identityId) return;
    await this.prisma.efiAccountIdentity.update({
      where: { id: identityId },
      data: {
        healthStatus,
        lastValidatedAt: new Date(),
        consecutiveFailures: healthStatus === 'HEALTHY' ? 0 : { increment: 1 },
        sanitizedLastError:
          healthStatus === 'HEALTHY' ? null : 'EFI_VALIDATION_FAILED',
      },
    });
  }
}
