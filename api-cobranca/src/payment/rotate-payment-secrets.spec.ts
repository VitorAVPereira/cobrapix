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
    companyReads: jest.Mock;
    updates: jest.Mock<
      Promise<{ count: number }>,
      [{ where: Record<string, unknown>; data: Record<string, unknown> }]
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
        where: Record<string, unknown>;
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
    const companyReads = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'tenant-1' }])
      .mockResolvedValue([]);
    const prisma = {
      company: {
        findMany: companyReads,
      },
      efiCredentialVersion: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>): Promise<unknown> =>
          callback(tx),
      ),
    } as unknown as PrismaService;
    return { prisma, gateway, companyReads, updates };
  }

  function onboardingFixture(fieldCrypto: PaymentCryptoService = previous): {
    prisma: PrismaService;
    onboarding: Record<string, unknown>;
    updates: jest.Mock<
      Promise<{ count: number }>,
      [{ where: Record<string, unknown>; data: Record<string, unknown> }]
    >;
  } {
    const onboarding: Record<string, unknown> = {
      companyId: 'tenant-1',
      updatedAt: new Date('2026-09-09T12:00:00.000Z'),
      representativeNameEncrypted: fieldCrypto.encrypt('Maria Silva'),
      representativeCpfEncrypted: fieldCrypto.encrypt('12345678901'),
      representativeBirthDateEncrypted: fieldCrypto.encrypt('1990-01-02'),
      representativeMotherNameEncrypted: fieldCrypto.encrypt('Ana Silva'),
      representativeEmailEncrypted: fieldCrypto.encrypt('maria@example.com'),
      representativePhoneEncrypted: fieldCrypto.encrypt('+5511999999999'),
    };
    const updates = jest.fn(
      (input: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }): Promise<{ count: number }> => {
        Object.assign(onboarding, input.data);
        return Promise.resolve({ count: 1 });
      },
    );
    const tx = {
      gatewayAccount: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
      },
      efiOnboarding: {
        findUnique: jest.fn().mockResolvedValue(onboarding),
        updateMany: updates,
      },
    };
    const prisma = {
      company: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ id: 'tenant-1' }])
          .mockResolvedValue([]),
      },
      efiCredentialVersion: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>): Promise<unknown> =>
          callback(tx),
      ),
    } as unknown as PrismaService;
    return { prisma, onboarding, updates };
  }

  it.each([0, 101, 1.5])(
    'rejects invalid batch size %s before reading companies',
    async (batchSize: number) => {
      const { prisma, companyReads } = fixture();

      await expect(
        rotatePaymentSecrets(prisma, crypto, { batchSize }),
      ).rejects.toThrow('Lote deve conter entre 1 e 100 empresas');
      expect(companyReads).not.toHaveBeenCalled();
    },
  );

  it('accepts the maximum batch size of 100 companies', async () => {
    const { prisma, companyReads } = fixture();

    await rotatePaymentSecrets(prisma, crypto, { batchSize: 100 });

    expect(companyReads).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ take: 100 }),
    );
  });

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
    const input = updates.mock.calls[0]?.[0] as unknown as {
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

  it('rotates all six onboarding fields and applies version with tenant CAS', async () => {
    const { prisma, onboarding, updates } = onboardingFixture();

    await expect(
      rotatePaymentSecrets(prisma, crypto, { apply: true }),
    ).resolves.toEqual({ apply: true, inspected: 1, changed: 1 });

    const expectedPlaintexts: Record<string, string> = {
      representativeNameEncrypted: 'Maria Silva',
      representativeCpfEncrypted: '12345678901',
      representativeBirthDateEncrypted: '1990-01-02',
      representativeMotherNameEncrypted: 'Ana Silva',
      representativeEmailEncrypted: 'maria@example.com',
      representativePhoneEncrypted: '+5511999999999',
    };
    for (const [field, plaintext] of Object.entries(expectedPlaintexts)) {
      const encrypted = String(onboarding[field]);
      expect(crypto.getEnvelopeKeyVersion(encrypted)).toBe('v2');
      expect(crypto.decrypt(encrypted)).toBe(plaintext);
    }
    expect(onboarding.sensitiveDataKeyVersion).toBe('v2');
    expect(updates).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'tenant-1',
          updatedAt: new Date('2026-09-09T12:00:00.000Z'),
        },
      }),
    );
  });

  it('keeps onboarding ciphertext unchanged during dry run', async () => {
    const { prisma, onboarding, updates } = onboardingFixture();
    const encryptedName = onboarding.representativeNameEncrypted;

    await expect(rotatePaymentSecrets(prisma, crypto)).resolves.toEqual({
      apply: false,
      inspected: 1,
      changed: 1,
    });

    expect(onboarding.representativeNameEncrypted).toBe(encryptedName);
    expect(updates).not.toHaveBeenCalled();
  });

  it('does not update onboarding data already encrypted with the active key', async () => {
    const { prisma, updates } = onboardingFixture(crypto);

    await expect(
      rotatePaymentSecrets(prisma, crypto, { apply: true }),
    ).resolves.toEqual({ apply: true, inspected: 1, changed: 0 });
    expect(updates).not.toHaveBeenCalled();
  });

  it('rejects corrupt onboarding data without writing a partial rotation', async () => {
    const { prisma, onboarding, updates } = onboardingFixture();
    onboarding.representativePhoneEncrypted = 'corrupted';

    await expect(
      rotatePaymentSecrets(prisma, crypto, { apply: true }),
    ).rejects.toThrow('Dados criptografados inválidos');
    expect(updates).not.toHaveBeenCalled();
  });

  it('aborts when onboarding data changes concurrently', async () => {
    const { prisma, updates } = onboardingFixture();
    updates.mockResolvedValue({ count: 0 });

    await expect(
      rotatePaymentSecrets(prisma, crypto, { apply: true }),
    ).rejects.toThrow('Registro alterado durante rotação');
  });

  it('rotates credential versions and leaves wiped ones untouched', async () => {
    const at = new Date('2026-09-25T12:00:00.000Z');
    const rows = [
      {
        id: 'credential-1',
        updatedAt: at,
        encryptedClientId: previous.encrypt('client'),
        encryptedClientSecret: previous.encrypt('secret'),
        encryptedCertificate: previous.encrypt('p12'),
        encryptedCertificatePassword: null,
      },
      {
        id: 'credential-2',
        updatedAt: at,
        encryptedClientId: '',
        encryptedClientSecret: '',
        encryptedCertificate: '',
        encryptedCertificatePassword: null,
      },
    ];
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = { efiCredentialVersion: { updateMany } };
    const prisma = {
      company: { findMany: jest.fn().mockResolvedValue([]) },
      efiCredentialVersion: {
        findMany: jest.fn().mockResolvedValueOnce(rows).mockResolvedValue([]),
      },
      $transaction: jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>): Promise<unknown> =>
          callback(tx),
      ),
    } as unknown as PrismaService;

    await expect(
      rotatePaymentSecrets(prisma, crypto, { apply: true }),
    ).resolves.toEqual({ apply: true, inspected: 2, changed: 1 });
    expect(updateMany).toHaveBeenCalledTimes(1);
    const [{ where, data }] = updateMany.mock.calls[0] as [
      { where: object; data: Record<string, string | null> },
    ];
    expect(where).toEqual({ id: 'credential-1', updatedAt: at });
    expect(data.credentialKeyVersion).toBe('v2');
    expect(crypto.getEnvelopeKeyVersion(data.encryptedClientSecret ?? '')).toBe(
      'v2',
    );
    expect(crypto.decrypt(data.encryptedCertificate ?? '')).toBe('p12');
    expect(data.encryptedCertificatePassword).toBeNull();
  });
});
