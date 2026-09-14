import { ConfigService } from '@nestjs/config';
import { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { OnboardingJobs } from './onboarding-jobs';
import { EfiOnboardingService } from './efi-onboarding.service';

describe('tenant onboarding draft and submission API', () => {
  const user: AuthenticatedUser = {
    companyId: 'tenant',
    userId: 'user',
    email: 'user@example.test',
    role: 'COMPANY_ADMIN',
    mustChangePassword: false,
    tokenVersion: 0,
  };
  const config = new ConfigService({
    PAYMENT_SECRET_KEY: '11'.repeat(32),
    EFI_ONBOARDING_AUTHORIZATION_VERSION: 'v1',
    EFI_ONBOARDING_TERMS_VERSION: 'v1',
    EFI_ONBOARDING_PRIVACY_VERSION: 'v1',
  });
  const crypto = new PaymentCryptoService(config);
  function fixture(): {
    service: EfiOnboardingService;
    row: Record<string, unknown>;
    company: Record<string, unknown>;
    jobs: jest.Mock;
  } {
    const company: Record<string, unknown> = {
      id: 'tenant',
      corporateName: 'Empresa',
      tradeName: 'Loja',
      document: '11222333000181',
      addressPostalCode: '01001000',
      addressStreet: 'Rua',
      addressNumber: '1',
      addressDistrict: 'Centro',
      addressCity: 'São Paulo',
      addressState: 'SP',
    };
    const row: Record<string, unknown> = {
      id: 'row',
      companyId: 'tenant',
      status: 'DRAFT',
      draftRevision: 1,
      consentDraftRevision: null,
      consentAcceptedAt: null,
      retryBlockedUntil: null,
      representativeNameEncrypted: null,
      representativeCpfEncrypted: null,
      representativeBirthDateEncrypted: null,
      representativeMotherNameEncrypted: null,
      representativeEmailEncrypted: null,
      representativePhoneEncrypted: null,
    };
    const tx = {
      company: {
        findUnique: jest.fn().mockResolvedValue(company),
        update: jest.fn(
          (input: {
            data: Record<string, unknown>;
          }): Promise<Record<string, unknown>> => {
            Object.assign(company, input.data);
            return Promise.resolve(company);
          },
        ),
      },
      efiOnboarding: {
        findUnique: jest.fn().mockResolvedValue(row),
        updateMany: jest.fn(
          (input: {
            data: Record<string, unknown>;
          }): Promise<{ count: number }> => {
            Object.assign(row, input.data);
            return Promise.resolve({ count: 1 });
          },
        ),
        create: jest.fn(),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      platformIntegrationState: {
        findUnique: jest.fn().mockResolvedValue({ enabled: true }),
      },
    };
    const prisma = {
      ...tx,
      $transaction: (
        callback: (client: typeof tx) => Promise<unknown>,
      ): Promise<unknown> => callback(tx),
    } as unknown as PrismaService;
    const jobs = jest.fn().mockResolvedValue(undefined);
    return {
      service: new EfiOnboardingService(prisma, crypto, config, {
        schedule: jobs,
      } as unknown as OnboardingJobs),
      row,
      company,
      jobs,
    };
  }

  it('encrypts representative data and binds consent to the saved draft revision', async () => {
    const { service, row, company } = fixture();
    const result = await service.saveDraft(
      user,
      {
        revision: 1,
        corporateName: 'Empresa Corrigida',
        representative: {
          name: 'Representante Externo',
          cpf: '52998224725',
          birthDate: '1980-01-01',
          motherName: 'Nome da Mãe',
          email: 'legal@example.test',
          phone: '11999999999',
        },
        consent: {
          authorized: true,
          termsAccepted: true,
          privacyAccepted: true,
          authorizationVersion: 'v1',
          termsVersion: 'v1',
          privacyVersion: 'v1',
        },
      },
      '127.0.0.1',
    );
    expect(company.corporateName).toBe('Empresa Corrigida');
    expect(row.consentDraftRevision).toBe(2);
    expect(crypto.decrypt(String(row.representativeCpfEncrypted))).toBe(
      '52998224725',
    );
    expect(JSON.stringify(result)).not.toContain('52998224725');
    expect(JSON.stringify(result)).not.toContain(
      String(row.representativeCpfEncrypted),
    );
  });

  it('rejects an admin using company-only operations', async () => {
    const { service } = fixture();
    await expect(
      service.get({ ...user, role: 'PLATFORM_ADMIN' }),
    ).rejects.toThrow();
  });

  it('blocks draft changes while pending and refuses stale revisions', async () => {
    const { service, row } = fixture();
    row.status = 'AWAITING_REPRESENTATIVE';
    await expect(
      service.saveDraft(user, { revision: 1 }, '127.0.0.1'),
    ).rejects.toThrow();
    row.status = 'DRAFT';
    await expect(
      service.saveDraft(user, { revision: 0 }, '127.0.0.1'),
    ).rejects.toThrow();
  });

  it('rejects submission of an incomplete or unconsented draft', async () => {
    const { service, jobs } = fixture();
    await expect(service.submit(user)).rejects.toThrow();
    expect(jobs).not.toHaveBeenCalled();
  });

  it('saves, resumes and queues the consented draft without issuing a payment', async () => {
    const { service, row, jobs } = fixture();
    await service.saveDraft(
      user,
      {
        revision: 1,
        representative: {
          name: 'Representante',
          cpf: '52998224725',
          birthDate: '1980-01-01',
          motherName: 'Nome da Mãe',
          email: 'legal@example.test',
          phone: '11999999999',
        },
        consent: {
          authorized: true,
          termsAccepted: true,
          privacyAccepted: true,
          authorizationVersion: 'v1',
          termsVersion: 'v1',
          privacyVersion: 'v1',
        },
      },
      '127.0.0.1',
    );
    expect(await service.get(user)).toMatchObject({
      status: 'DRAFT',
      revision: 2,
      representativeProvided: true,
    });
    await service.submit(user);
    expect(row.status).toBe('NOTICE_PENDING');
    expect(row.submittedCompanyDocument).toBe('11222333000181');
    expect(jobs).toHaveBeenCalledWith('tenant', 'submit', 200);
  });

  it('invalidates earlier consent whenever a corrected draft is saved', async () => {
    const { service, row } = fixture();
    row.consentAcceptedAt = new Date();
    row.consentDraftRevision = 1;
    await service.saveDraft(
      user,
      { revision: 1, tradeName: 'Novo Nome' },
      '127.0.0.1',
    );
    expect(row.consentAcceptedAt).toBeNull();
    expect(row.consentDraftRevision).toBeNull();
    expect(row.draftRevision).toBe(2);
  });
});
