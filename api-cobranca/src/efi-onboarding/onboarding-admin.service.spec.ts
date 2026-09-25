import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { GatewayHealthService } from '../payment/gateway-health.service';
import { EfiOpeningClient } from './efi-opening.client';
import { OnboardingJobs } from './onboarding-jobs';
import { OnboardingAdminService } from './onboarding-admin.service';

describe('onboarding activation environment gate', () => {
  function fixture(configValues: Record<string, string>): {
    service: OnboardingAdminService;
    registerWebhook: jest.Mock<Promise<void>, [string]>;
    upsert: jest.Mock<
      Promise<unknown>,
      [Prisma.PlatformIntegrationStateUpsertArgs]
    >;
  } {
    const registerWebhook = jest
      .fn<Promise<void>, [string]>()
      .mockResolvedValue(undefined);
    const upsert = jest
      .fn<Promise<unknown>, [Prisma.PlatformIntegrationStateUpsertArgs]>()
      .mockResolvedValue({});
    const config = new ConfigService({
      NODE_ENV: 'production',
      EFI_ENV: 'homologation',
      EFI_LEGAL_APPROVED: 'false',
      EFI_WEBHOOK_BASE_URL: 'https://efi-webhooks.example.com',
      ...configValues,
    });
    const service = new OnboardingAdminService(
      { platformIntegrationState: { upsert } } as unknown as PrismaService,
      {} as PaymentCryptoService,
      config,
      { registerWebhook } as unknown as EfiOpeningClient,
      {} as OnboardingJobs,
      {} as GatewayHealthService,
    );
    return { service, registerWebhook, upsert };
  }

  it('allows the administrator to enable homologation on a production Node server', async (): Promise<void> => {
    const { service, registerWebhook, upsert } = fixture({});

    await service.setEnabled('EFI_ONBOARDING', true);

    expect(registerWebhook).toHaveBeenCalledWith(
      'https://efi-webhooks.example.com/webhooks/efi/account-opening',
    );
    expect(upsert).toHaveBeenCalledWith({
      where: { integration: 'EFI_ONBOARDING' },
      create: {
        integration: 'EFI_ONBOARDING',
        enabled: true,
        pausedAt: null,
      },
      update: { enabled: true, pausedAt: null, pauseReason: null },
    });
  });

  it.each(['production', 'development', 'test'])(
    'blocks real Efi activation without approval when NODE_ENV is %s',
    async (nodeEnvironment: string): Promise<void> => {
      const { service, registerWebhook, upsert } = fixture({
        NODE_ENV: nodeEnvironment,
        EFI_ENV: 'production',
      });

      await expect(
        service.setEnabled('EFI_ONBOARDING', true),
      ).rejects.toMatchObject({
        response: { code: 'EFI_LEGAL_APPROVAL_REQUIRED' },
        status: 409,
      });
      expect(registerWebhook).not.toHaveBeenCalled();
      expect(upsert).not.toHaveBeenCalled();
    },
  );

  it('does not treat an unknown Efi environment as homologation', async (): Promise<void> => {
    const { service, registerWebhook, upsert } = fixture({ EFI_ENV: '' });

    await expect(
      service.setEnabled('EFI_ONBOARDING', true),
    ).rejects.toMatchObject({
      response: { code: 'EFI_LEGAL_APPROVAL_REQUIRED' },
    });
    expect(registerWebhook).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('allows approved production activation after webhook registration', async (): Promise<void> => {
    const { service, registerWebhook, upsert } = fixture({
      EFI_ENV: 'production',
      EFI_LEGAL_APPROVED: 'true',
    });

    await service.setEnabled('EFI_ONBOARDING', true);

    expect(registerWebhook).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { enabled: true, pausedAt: null, pauseReason: null },
      }),
    );
  });

  it('leaves activation paused when webhook registration fails', async (): Promise<void> => {
    const { service, registerWebhook, upsert } = fixture({});
    registerWebhook.mockRejectedValue(new Error('EFI_AUTHENTICATION_FAILED'));

    await expect(service.setEnabled('EFI_ONBOARDING', true)).rejects.toThrow(
      'EFI_AUTHENTICATION_FAILED',
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it('allows pausing production even without legal approval', async (): Promise<void> => {
    const { service, registerWebhook, upsert } = fixture({
      EFI_ENV: 'production',
    });

    await service.setEnabled('EFI_ONBOARDING', false);

    expect(registerWebhook).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          enabled: false,
          pausedAt: expect.any(Date) as unknown,
          pauseReason: 'ADMIN_PAUSED',
        },
      }),
    );
  });
});

describe('manual onboarding ownership verification', () => {
  function fixture(): {
    service: OnboardingAdminService;
    getCredentials: jest.Mock;
    audit: jest.Mock;
  } {
    const row = {
      id: 'row',
      status: 'SUBMISSION_UNCERTAIN',
      draftRevision: 1,
      submittedCompanyDocument: '12345678000195',
      company: { document: '12345678000195' },
      simplifiedAccountRequestId: null,
    };
    const audit = jest.fn().mockResolvedValue({});
    const models = {
      efiOnboarding: {
        findUnique: jest.fn().mockResolvedValue(row),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: audit },
    };
    const prisma = {
      ...models,
      $transaction: async (
        fn: (tx: typeof models) => Promise<void>,
      ): Promise<void> => fn(models),
    };
    const getCredentials = jest.fn().mockResolvedValue({ active: true });
    const service = new OnboardingAdminService(
      prisma as unknown as PrismaService,
      {} as PaymentCryptoService,
      new ConfigService(),
      { getCredentials } as unknown as EfiOpeningClient,
      {} as OnboardingJobs,
      {} as GatewayHealthService,
    );
    jest.spyOn(service, 'retry').mockResolvedValue({});
    return { service, getCredentials, audit };
  }
  it('blocks an unbound provider identifier without explicit ownership verification', async () => {
    const { service, getCredentials } = fixture();
    await expect(
      service.manual('tenant', 'admin', { requestId: 'other-account' }),
    ).rejects.toMatchObject({
      response: { code: 'EFI_OWNERSHIP_VERIFICATION_REQUIRED' },
    });
    expect(getCredentials).not.toHaveBeenCalled();
  });
  it('rejects a verified document from a different company', async () => {
    const { service, getCredentials } = fixture();
    await expect(
      service.manual('tenant', 'admin', {
        requestId: 'other-account',
        ownershipVerified: true,
        verifiedCompanyDocument: '98765432000100',
      }),
    ).rejects.toMatchObject({
      response: { code: 'EFI_OWNERSHIP_VERIFICATION_REQUIRED' },
    });
    expect(getCredentials).not.toHaveBeenCalled();
  });
  it('records the administrator attestation when binding an unknown identifier', async () => {
    const { service, audit } = fixture();
    await service.manual('tenant', 'admin', {
      requestId: 'confirmed-account',
      ownershipVerified: true,
      verifiedCompanyDocument: '12345678000195',
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'admin',
          changes: expect.objectContaining({
            ownershipVerification: 'ADMIN_EFI_PORTAL_ATTESTATION',
            verifiedCompanyDocument: '12345678000195',
          }) as unknown,
        }) as unknown,
      }),
    );
  });
});
