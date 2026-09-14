import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EfiGatewayClient } from './efi-gateway.client';

@Injectable()
export class GatewayHealthService {
  private readonly logger = new Logger(GatewayHealthService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: EfiGatewayClient,
  ) {}
  async assertIssuable(companyId: string): Promise<void> {
    const onboarding = await this.prisma.efiOnboarding.findUnique({
      where: { companyId },
      select: { status: true },
    });
    if (onboarding?.status !== 'ACTIVE')
      this.fail(
        'EFI_ONBOARDING_REQUIRED',
        'Conclua a ativação financeira antes de emitir cobranças.',
      );
    const state = await this.prisma.platformIntegrationState.findUnique({
      where: { integration: 'EFI_PAYMENTS' },
      select: { enabled: true },
    });
    if (!state?.enabled)
      this.fail(
        'EFI_PAYMENTS_PAUSED',
        'Novas emissões estão temporariamente pausadas.',
      );
    const account = await this.prisma.gatewayAccount.findUnique({
      where: { companyId },
    });
    if (!account || account.status !== 'ACTIVE')
      this.fail(
        'EFI_ONBOARDING_REQUIRED',
        'A conta financeira precisa estar ativa.',
      );
    if (account.consecutiveFailures >= 2 || !(await this.validate(companyId)))
      this.fail(
        'EFI_INTEGRATION_UNHEALTHY',
        'A integração financeira está indisponível. Tente novamente após a validação.',
      );
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
      if (failed.consecutiveFailures >= 2)
        await this.prisma.gatewayAccount.update({
          where: { companyId },
          data: { healthStatus: 'UNAVAILABLE' },
        });
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
  private fail(code: string, message: string): never {
    throw new HttpException({ code, message }, 409);
  }
}
