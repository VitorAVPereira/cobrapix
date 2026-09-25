import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { EfiGatewayClient } from '../payment/efi-gateway.client';
import { GatewayHealthService } from '../payment/gateway-health.service';
import { EfiOpeningClient } from './efi-opening.client';
import { OnboardingNotifications } from './onboarding-notifications';
import { OnboardingLifecycle } from './onboarding-lifecycle';
import * as openingProfile from '../financial-activation/opening-profile';

jest.mock('../financial-activation/opening-profile', (): object => ({
  ...jest.requireActual('../financial-activation/opening-profile'),
  hasActiveManualProfile: jest.fn().mockResolvedValue(false),
  publishOpeningProfile: jest.fn().mockResolvedValue('profile-1'),
  syncOpeningCredential: jest.fn().mockResolvedValue(undefined),
}));

describe('certificate maintenance concurrency', () => {
  it('never erases another worker renewal claim while recording an alert', async () => {
    const row = {
      status: 'ACTIVE',
      simplifiedAccountRequestId: 'request',
      updatedAt: new Date(1),
      provisioningCheckpoint: {},
    };
    const account = {
      status: 'ACTIVE',
      certificateFingerprint: 'old',
      certificateExpiresAt: new Date(Date.now() + 86400_000),
    };
    let releaseAlert!: () => void;
    const alertBarrier = new Promise<void>((resolve) => {
      releaseAlert = resolve;
    });
    let alertCount = 0;
    const alert = jest.fn(async (): Promise<void> => {
      if (++alertCount === 1) await alertBarrier;
    });
    const createCertificate = jest.fn().mockRejectedValue(new Error('timeout'));
    const prisma = {
      efiOnboarding: {
        findUnique: jest.fn(
          (): Promise<object> =>
            Promise.resolve({
              ...row,
              provisioningCheckpoint: { ...row.provisioningCheckpoint },
            }),
        ),
        updateMany: jest.fn(
          (args: {
            where: { updatedAt?: Date };
            data: { provisioningCheckpoint: object };
          }): Promise<{ count: number }> => {
            if (
              args.where.updatedAt &&
              args.where.updatedAt.getTime() !== row.updatedAt.getTime()
            )
              return Promise.resolve({ count: 0 });
            row.provisioningCheckpoint = args.data.provisioningCheckpoint;
            row.updatedAt = new Date(row.updatedAt.getTime() + 1);
            return Promise.resolve({ count: 1 });
          },
        ),
      },
      gatewayAccount: { findUnique: jest.fn().mockResolvedValue(account) },
    };
    const service = new OnboardingLifecycle(
      prisma as unknown as PrismaService,
      {} as PaymentCryptoService,
      { createCertificate } as unknown as EfiOpeningClient,
      {} as EfiGatewayClient,
      {} as GatewayHealthService,
      { alert } as unknown as OnboardingNotifications,
    );
    const first = service.renew('tenant');
    await new Promise<void>((resolve) => setImmediate(resolve));
    await service.renew('tenant');
    releaseAlert();
    await first;
    expect(createCertificate).toHaveBeenCalledTimes(1);
    expect(row.provisioningCheckpoint).toMatchObject({
      renewalRequestedFor: 'old',
    });
  });

  describe('with a manual activation', () => {
    const untouchable = new Proxy(
      {},
      {
        get(): never {
          throw new Error('UNEXPECTED_ACCESS');
        },
      },
    );
    function lifecycle(prisma: object): OnboardingLifecycle {
      return new OnboardingLifecycle(
        prisma as PrismaService,
        untouchable as PaymentCryptoService,
        untouchable as EfiOpeningClient,
        untouchable as EfiGatewayClient,
        untouchable as GatewayHealthService,
        untouchable as OnboardingNotifications,
      );
    }
    beforeEach(() => {
      jest
        .mocked(openingProfile.hasActiveManualProfile)
        .mockResolvedValueOnce(true);
    });

    it('does not renew the certificate through the opening API', async () => {
      await lifecycle({
        efiOnboarding: {
          findUnique: jest.fn().mockResolvedValue({
            status: 'ACTIVE',
            simplifiedAccountRequestId: 'request',
          }),
        },
        gatewayAccount: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ certificateExpiresAt: new Date() }),
        },
      }).renew('tenant');
    });

    it('refuses the opening disconnection that wipes credentials', async () => {
      await expect(
        lifecycle(untouchable).disconnect('tenant', 'admin'),
      ).rejects.toMatchObject({
        response: { code: 'FINANCIAL_PROFILE_MANUAL' },
      });
    });
  });
});
