import { HttpException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialEligibilityService } from '../financial-activation/financial-eligibility.service';
import { EfiGatewayClient } from './efi-gateway.client';
import { GatewayHealthService } from './gateway-health.service';

describe('financial health gate', () => {
  function fixture() {
    const account: Record<string, unknown> = {
      companyId: 'tenant',
      status: 'ACTIVE',
      certificateExpiresAt: new Date(Date.now() + 86400_000),
      consecutiveFailures: 0,
      efiAccountIdentityId: 'identity-1',
    };
    const identityUpdates: Array<Record<string, unknown>> = [];
    const validate = jest.fn().mockRejectedValue(new Error('provider secret'));
    const resolveIssuance = jest.fn().mockResolvedValue({});
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
    const service = new GatewayHealthService(
      {
        gatewayAccount: model,
        efiAccountIdentity: {
          update: jest.fn((args: { data: Record<string, unknown> }) => {
            identityUpdates.push(args.data);
            return Promise.resolve({});
          }),
        },
      } as unknown as PrismaService,
      { validate } as unknown as EfiGatewayClient,
      { resolveIssuance } as unknown as FinancialEligibilityService,
    );
    return { service, account, validate, resolveIssuance, identityUpdates };
  }

  it('decides issuance by the published profile, without a live provider call', async () => {
    const { service, validate, resolveIssuance } = fixture();
    await service.assertIssuable('tenant', 'PIX');
    expect(resolveIssuance).toHaveBeenCalledWith('tenant', 'PIX');
    expect(validate).not.toHaveBeenCalled();
    resolveIssuance.mockRejectedValue(
      new HttpException({ code: 'FINANCIAL_PROFILE_NOT_READY' }, 409),
    );
    await expect(service.assertIssuable('tenant')).rejects.toMatchObject({
      response: { code: 'FINANCIAL_PROFILE_NOT_READY' },
    });
  });

  it('records two consecutive failures on the account and its identity', async () => {
    const { service, account, identityUpdates } = fixture();
    await service.validate('tenant');
    await service.validate('tenant');
    expect(account.consecutiveFailures).toBe(2);
    expect(account.healthStatus).toBe('UNAVAILABLE');
    expect(account.status).toBe('ACTIVE');
    expect(identityUpdates.map((data) => data.healthStatus)).toEqual([
      'DEGRADED',
      'UNAVAILABLE',
    ]);
    expect(JSON.stringify([account, identityUpdates])).not.toContain(
      'provider secret',
    );
  });

  it('restores health only after successful live validation', async () => {
    const { service, account, validate, identityUpdates } = fixture();
    account.consecutiveFailures = 2;
    validate.mockResolvedValue(undefined);
    await service.validate('tenant');
    expect(account.consecutiveFailures).toBe(0);
    expect(account.healthStatus).toBe('HEALTHY');
    expect(identityUpdates.at(-1)).toMatchObject({
      healthStatus: 'HEALTHY',
      consecutiveFailures: 0,
    });
  });
});
