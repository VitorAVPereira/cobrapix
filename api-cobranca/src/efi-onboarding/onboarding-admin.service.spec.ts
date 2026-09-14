import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { GatewayHealthService } from '../payment/gateway-health.service';
import { EfiOpeningClient } from './efi-opening.client';
import { OnboardingJobs } from './onboarding-jobs';
import { OnboardingAdminService } from './onboarding-admin.service';

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
