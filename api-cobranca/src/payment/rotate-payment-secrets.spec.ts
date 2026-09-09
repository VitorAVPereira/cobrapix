import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from './payment-crypto.service';
import { rotatePaymentSecrets } from './rotate-payment-secrets';

describe('transactional payment secret rotation', () => {
  const keys = JSON.stringify({ v1: '11'.repeat(32), v2: '22'.repeat(32) });
  const previous = new PaymentCryptoService(
    new ConfigService({
      PAYMENT_ENCRYPTION_KEYS: keys,
      PAYMENT_ACTIVE_KEY_VERSION: 'v1',
    }),
  );
  const crypto = new PaymentCryptoService(
    new ConfigService({
      PAYMENT_ENCRYPTION_KEYS: keys,
      PAYMENT_ACTIVE_KEY_VERSION: 'v2',
    }),
  );

  function fixture(): {
    prisma: PrismaService;
    gateway: Record<string, unknown>;
    updates: jest.Mock<
      Promise<{ count: number }>,
      [{ data: Record<string, unknown> }]
    >;
  } {
    const gateway: Record<string, unknown> = {
      companyId: 'tenant-1',
      updatedAt: new Date(),
      encryptedClientId: previous.encrypt('id'),
      encryptedClientSecret: previous.encrypt('secret'),
      encryptedCertificate: null,
      encryptedCertificatePassword: null,
    };
    const updates = jest.fn(
      (input: {
        data: Record<string, unknown>;
      }): Promise<{ count: number }> => {
        Object.assign(gateway, input.data);
        return Promise.resolve({ count: 1 });
      },
    );
    const tx = {
      gatewayAccount: {
        findUnique: jest.fn().mockResolvedValue(gateway),
        updateMany: updates,
      },
      efiOnboarding: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
      },
    };
    const prisma = {
      company: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ id: 'tenant-1' }])
          .mockResolvedValue([]),
      },
      $transaction: jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>): Promise<unknown> =>
          callback(tx),
      ),
    } as unknown as PrismaService;
    return { prisma, gateway, updates };
  }

  it('defaults to dry run and reports candidates without updating secrets', async () => {
    const { prisma, gateway, updates } = fixture();
    const encrypted = gateway.encryptedClientSecret;
    expect(await rotatePaymentSecrets(prisma, crypto)).toEqual({
      apply: false,
      inspected: 1,
      changed: 1,
    });
    expect(gateway.encryptedClientSecret).toBe(encrypted);
    expect(updates).not.toHaveBeenCalled();
  });

  it('applies new version with compare-and-swap and preserves tenant scope', async () => {
    const { prisma, gateway, updates } = fixture();
    expect(await rotatePaymentSecrets(prisma, crypto, { apply: true })).toEqual(
      { apply: true, inspected: 1, changed: 1 },
    );
    expect(gateway.credentialKeyVersion).toBe('v2');
    expect(crypto.decrypt(String(gateway.encryptedClientSecret))).toBe(
      'secret',
    );
    const input = updates.mock.calls[0]?.[0] as {
      where: { companyId: string; updatedAt: Date };
    };
    expect(input.where.companyId).toBe('tenant-1');
    expect(input.where.updatedAt).toBeInstanceOf(Date);
  });

  it('aborts when credentials changed concurrently', async () => {
    const { prisma, updates } = fixture();
    updates.mockResolvedValue({ count: 0 });
    await expect(
      rotatePaymentSecrets(prisma, crypto, { apply: true }),
    ).rejects.toThrow('Registro alterado durante rotação');
  });
});
