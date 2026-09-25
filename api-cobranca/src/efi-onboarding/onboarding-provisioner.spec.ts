import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { EfiGatewayClient } from '../payment/efi-gateway.client';
import { EfiOpeningClient, EFI_REQUIRED_SCOPES } from './efi-opening.client';
import { OnboardingJobs } from './onboarding-jobs';
import { OnboardingNotifications } from './onboarding-notifications';
import { OnboardingProvisioner } from './onboarding-provisioner';
import * as openingProfile from '../financial-activation/opening-profile';

jest.mock('../financial-activation/opening-profile', (): object => ({
  ...jest.requireActual('../financial-activation/opening-profile'),
  hasActiveManualProfile: jest.fn().mockResolvedValue(false),
  publishOpeningProfile: jest.fn().mockResolvedValue('profile-1'),
  syncOpeningCredential: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../payment/efi-certificate', (): object => ({
  inspectEfiCertificate: (): object => ({
    base64: 'normalized-p12',
    expiresAt: new Date('2035-01-01'),
    fingerprint: 'fingerprint',
  }),
}));

describe('durable Efí provisioning', () => {
  function fixture(): {
    service: OnboardingProvisioner;
    row: Record<string, unknown>;
    account: Record<string, unknown>;
    opening: { getCredentials: jest.Mock; createCertificate: jest.Mock };
    gateway: {
      listEvp: jest.Mock;
      createEvp: jest.Mock;
      configureWebhooks: jest.Mock;
      validate: jest.Mock;
    };
    schedule: jest.Mock;
    alert: jest.Mock;
  } {
    const row: Record<string, unknown> = {
      id: 'onboarding',
      companyId: 'tenant',
      status: 'PROVISIONING',
      draftRevision: 1,
      provisioningAttempts: 0,
      submittedCompanyDocument: '123',
      simplifiedAccountRequestId: 'request',
      company: { document: '123' },
    };
    const account: Record<string, unknown> = {};
    const efiOnboarding = {
      findUnique: jest.fn().mockResolvedValue(row),
      updateMany: jest.fn(
        (args: {
          data: Record<string, unknown>;
          where?: Record<string, unknown>;
        }): Promise<{ count: number }> => {
          for (const key of [
            'status',
            'draftRevision',
            'provisioningAttempts',
          ]) {
            const expected = args.where?.[key];
            if (
              expected !== undefined &&
              typeof expected !== 'object' &&
              row[key] !== expected
            )
              return Promise.resolve({ count: 0 });
          }
          Object.assign(row, args.data);
          return Promise.resolve({ count: 1 });
        },
      ),
    };
    const gatewayAccount = {
      findUnique: jest.fn(
        (): Promise<object | null> =>
          Promise.resolve(account.companyId ? account : null),
      ),
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(
        (args: { create: object; update: object }): Promise<object> => {
          Object.assign(account, account.companyId ? args.update : args.create);
          return Promise.resolve(account);
        },
      ),
      update: jest.fn((args: { data: object }): Promise<object> => {
        Object.assign(account, args.data);
        return Promise.resolve(account);
      }),
    };
    const models = {
      efiOnboarding,
      gatewayAccount,
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      ...models,
      $transaction: (
        callback: (tx: typeof models) => Promise<unknown>,
      ): Promise<unknown> => callback(models),
    } as unknown as PrismaService;
    const opening = {
      getCredentials: jest.fn().mockResolvedValue({
        clientId: 'client',
        clientSecret: 'secret',
        active: true,
        scopes: [...EFI_REQUIRED_SCOPES],
        accountNumber: '1234',
        accountDigit: '1',
        payeeCode: 'payee',
      }),
      createCertificate: jest.fn().mockResolvedValue('p12'),
    };
    const gateway = {
      listEvp: jest.fn().mockResolvedValue([]),
      createEvp: jest
        .fn()
        .mockResolvedValue('b6771952-690d-4a2a-8322-362f4a43a88c'),
      configureWebhooks: jest.fn().mockResolvedValue(undefined),
      validate: jest.fn().mockResolvedValue(undefined),
    };
    const schedule = jest.fn().mockResolvedValue(undefined);
    const alert = jest.fn().mockResolvedValue(undefined);
    return {
      row,
      account,
      opening,
      gateway,
      schedule,
      alert,
      service: new OnboardingProvisioner(
        prisma,
        {
          encrypt: (value: string): string => `encrypted:${value}`,
          decrypt: (value: string): string => value.replace('encrypted:', ''),
          activeKeyVersion: 'v1',
        } as PaymentCryptoService,
        new ConfigService({ EFI_ENV: 'homologation' }),
        opening as unknown as EfiOpeningClient,
        gateway as unknown as EfiGatewayClient,
        { schedule } as unknown as OnboardingJobs,
        { alert } as unknown as OnboardingNotifications,
      ),
    };
  }
  it('activates only after credentials, P12, exclusive EVP, both webhook contracts and validation', async () => {
    const { service, row, account, gateway } = fixture();
    gateway.validate.mockImplementation((): Promise<void> => {
      expect(row.status).toBe('PROVISIONING');
      expect(account.status).toBe('PENDING');
      return Promise.resolve();
    });
    await service.run('tenant', 101);
    expect(row.status).toBe('ACTIVE');
    expect(account.status).toBe('ACTIVE');
    expect(account.encryptedClientSecret).toBe('encrypted:secret');
    expect(row.representativeCpfEncrypted).toBeNull();
    expect(gateway.configureWebhooks).toHaveBeenCalledTimes(1);
    // The opening publishes its financial profile in the same transaction.
    expect(openingProfile.publishOpeningProfile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: 'tenant',
        onboardingId: 'onboarding',
        draftRevision: 1,
        requestId: 'request',
        account: expect.objectContaining({ status: 'ACTIVE' }) as unknown,
      }),
    );
  });
  // The rollback itself is covered with PostgreSQL in
  // test/financial-activation-lifecycle-postgres.cjs; this mock has no transactions.
  it('treats a profile publication conflict as terminal and alerts', async () => {
    const { service, alert, schedule } = fixture();
    jest
      .mocked(openingProfile.publishOpeningProfile)
      .mockRejectedValueOnce(
        new openingProfile.OpeningProfileConflict('ACCOUNT_ALREADY_REGISTERED'),
      );
    await service.run('tenant', 101);
    expect(alert).toHaveBeenCalledWith('tenant', 'ACCOUNT_ALREADY_REGISTERED');
    expect(schedule).not.toHaveBeenCalled();
  });
  it('leaves a manually activated company untouched', async () => {
    const { service, row, account, opening, alert } = fixture();
    jest
      .mocked(openingProfile.hasActiveManualProfile)
      .mockResolvedValueOnce(true);
    await service.run('tenant', 101);
    expect(opening.getCredentials).not.toHaveBeenCalled();
    expect(account).toEqual({});
    expect(row.status).toBe('CONFIGURATION_ERROR');
    expect(row.sanitizedErrorCode).toBe('FINANCIAL_MANUAL_ACTIVE');
    expect(alert).toHaveBeenCalledWith('tenant', 'FINANCIAL_MANUAL_ACTIVE');
  });
  it('rejects missing scopes and never requests a certificate', async () => {
    const { service, row, opening } = fixture();
    opening.getCredentials.mockResolvedValue({
      active: true,
      scopes: ['pix.read'],
    });
    await service.run('tenant', 101);
    expect(row.status).not.toBe('ACTIVE');
    expect(opening.createCertificate).not.toHaveBeenCalled();
  });
  it('does not recreate a certificate after an ambiguous request', async () => {
    const { service, row, opening } = fixture();
    row.provisioningCheckpoint = { certificateRequested: true };
    await service.run('tenant', 101);
    expect(opening.createCertificate).not.toHaveBeenCalled();
    expect(row.status).toBe('CONFIGURATION_ERROR');
    expect(row.sanitizedErrorCode).toBe('EFI_CERTIFICATE_UNCERTAIN');
  });
  it('adopts only an unambiguous EVP delta without creating another', async () => {
    const { service, row, account, gateway } = fixture();
    Object.assign(account, {
      companyId: 'tenant',
      encryptedCertificate: 'encrypted:p12',
      pixKey: '',
    });
    row.provisioningCheckpoint = { evpBefore: ['old-key'], evpRequested: true };
    gateway.listEvp.mockResolvedValue([
      'old-key',
      'b6771952-690d-4a2a-8322-362f4a43a88c',
    ]);
    await service.run('tenant', 101);
    expect(account.pixKey).toBe('b6771952-690d-4a2a-8322-362f4a43a88c');
    expect(gateway.createEvp).not.toHaveBeenCalled();
  });
  it('stops after five failures and alerts without activating', async () => {
    const { service, row, gateway, alert, schedule } = fixture();
    gateway.validate.mockRejectedValue(
      new Error('provider secret must not leak'),
    );
    for (let attempt = 1; attempt <= 5; attempt++) {
      row.provisioningCheckpoint = {};
      await service.run('tenant', 100 + attempt);
    }
    expect(row.status).toBe('CONFIGURATION_ERROR');
    expect(row.provisioningAttempts).toBe(5);
    expect(alert).toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(row)).not.toContain('provider secret');
  });
  it('does not restore secrets after disconnect while certificate creation is in flight', async () => {
    const { service, row, account, opening, gateway } = fixture();
    opening.createCertificate.mockImplementation((): Promise<string> => {
      row.status = 'DISCONNECTED';
      Object.assign(account, {
        status: 'DISABLED',
        encryptedClientId: '',
        encryptedClientSecret: '',
        encryptedCertificate: null,
        pixKey: '',
      });
      return Promise.resolve('p12');
    });
    await service.run('tenant', 101);
    expect(row.status).toBe('DISCONNECTED');
    expect(account.encryptedCertificate).toBeNull();
    expect(account.encryptedClientSecret).toBe('');
    expect(gateway.configureWebhooks).not.toHaveBeenCalled();
  });
});
