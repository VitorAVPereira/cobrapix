import { PrismaService } from '../prisma/prisma.service';
import { EfiGatewayClient } from './efi-gateway.client';
import { GatewayHealthService } from './gateway-health.service';

describe('financial health gate', () => {
  function fixture(): {
    service: GatewayHealthService;
    account: Record<string, unknown>;
    onboarding: { status: string };
    validate: jest.Mock;
  } {
    const account: Record<string, unknown> = {
      companyId: 'tenant',
      status: 'ACTIVE',
      certificateExpiresAt: new Date(Date.now() + 86400_000),
      consecutiveFailures: 0,
    };
    const onboarding = { status: 'ACTIVE' };
    const validate = jest.fn().mockRejectedValue(new Error('provider secret'));
    const model = {
      findUnique: jest.fn().mockResolvedValue(account),
      update: jest.fn(
        (args: { data: Record<string, unknown> }): Promise<object> => {
          const increment = args.data.consecutiveFailures as
            | { increment: number }
            | number
            | undefined;
          Object.assign(account, args.data);
          if (typeof increment === 'object')
            account.consecutiveFailures =
              Number(account.failCount ?? 0) + increment.increment;
          account.failCount = account.consecutiveFailures;
          return Promise.resolve(account);
        },
      ),
    };
    return {
      account,
      onboarding,
      validate,
      service: new GatewayHealthService(
        {
          gatewayAccount: model,
          efiOnboarding: {
            findUnique: jest.fn().mockResolvedValue(onboarding),
          },
          platformIntegrationState: {
            findUnique: jest.fn().mockResolvedValue({ enabled: true }),
          },
        } as unknown as PrismaService,
        { validate } as unknown as EfiGatewayClient,
      ),
    };
  }
  it('blocks onboarding drafts before contacting Efí', async () => {
    const { service, onboarding, validate } = fixture();
    onboarding.status = 'DRAFT';
    await expect(service.assertIssuable('tenant')).rejects.toMatchObject({
      response: { code: 'EFI_ONBOARDING_REQUIRED' },
    });
    expect(validate).not.toHaveBeenCalled();
  });
  it('records two consecutive failures and keeps current charges untouched', async () => {
    const { service, account } = fixture();
    await service.validate('tenant');
    await service.validate('tenant');
    expect(account.consecutiveFailures).toBe(2);
    expect(account.healthStatus).toBe('UNAVAILABLE');
    expect(account.status).toBe('ACTIVE');
    await expect(service.assertIssuable('tenant')).rejects.toMatchObject({
      response: { code: 'EFI_INTEGRATION_UNHEALTHY' },
    });
    expect(JSON.stringify(account)).not.toContain('provider secret');
  });
  it('restores health only after successful live validation', async () => {
    const { service, account, validate } = fixture();
    account.consecutiveFailures = 2;
    validate.mockResolvedValue(undefined);
    await service.validate('tenant');
    expect(account.consecutiveFailures).toBe(0);
    expect(account.healthStatus).toBe('HEALTHY');
  });
});
