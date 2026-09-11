import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { EfiGatewayClient } from '../payment/efi-gateway.client';
import { GatewayHealthService } from '../payment/gateway-health.service';
import { EfiOpeningClient } from './efi-opening.client';
import { OnboardingNotifications } from './onboarding-notifications';
import { OnboardingLifecycle } from './onboarding-lifecycle';

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
});
