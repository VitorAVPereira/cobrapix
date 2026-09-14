import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { EfiOpeningClient, EfiOpeningError } from './efi-opening.client';
import { OnboardingWorkflow } from './onboarding-workflow';
import { OnboardingNotifications } from './onboarding-notifications';
import { OnboardingJobs } from './onboarding-jobs';

describe('onboarding submission workflow', () => {
  afterEach((): void => {
    jest.useRealTimers();
  });
  const crypto = new PaymentCryptoService(
    new ConfigService({ PAYMENT_SECRET_KEY: '11'.repeat(32) }),
  );
  function fixture(): {
    workflow: OnboardingWorkflow;
    row: Record<string, unknown>;
    notice: jest.Mock;
    submit: jest.Mock;
    scheduled: jest.Mock;
    alert: jest.Mock;
  } {
    const row: Record<string, unknown> = {
      id: 'onboarding',
      companyId: 'tenant',
      status: 'NOTICE_PENDING',
      noticeAttempts: 0,
      noticeAcceptedAt: null,
      submissionAttempts: 0,
      simplifiedAccountRequestId: null,
      draftRevision: 1,
      sensitiveDataExpiresAt: new Date(Date.now() + 86400_000),
      submittedCompanyDocument: '12345678000190',
      representativeNameEncrypted: crypto.encrypt('Representante'),
      representativeCpfEncrypted: crypto.encrypt('12345678909'),
      representativeBirthDateEncrypted: crypto.encrypt('1980-01-01'),
      representativeMotherNameEncrypted: crypto.encrypt('Nome Mãe'),
      representativeEmailEncrypted: crypto.encrypt('legal@example.test'),
      representativePhoneEncrypted: crypto.encrypt('11999999999'),
      company: {
        corporateName: 'Empresa LTDA',
        tradeName: 'Loja',
        document: '12345678000190',
        addressPostalCode: '01001000',
        addressStreet: 'Rua',
        addressNumber: '1',
        addressDistrict: 'Centro',
        addressCity: 'São Paulo',
        addressState: 'SP',
      },
    };
    const prisma = {
      efiOnboarding: {
        findUnique: jest.fn().mockResolvedValue(row),
        updateMany: jest.fn(
          (input: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          }): Promise<{ count: number }> => {
            if (input.where.status && row.status !== input.where.status)
              return Promise.resolve({ count: 0 });
            for (const [field, value] of Object.entries(input.data)) {
              if (
                typeof value === 'object' &&
                value !== null &&
                'increment' in value
              )
                row[field] = Number(row[field]) + Number(value.increment);
              else row[field] = value;
            }
            return Promise.resolve({ count: 1 });
          },
        ),
      },
      platformIntegrationState: {
        findUnique: jest.fn().mockResolvedValue({ enabled: true }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;
    const notice = jest.fn().mockResolvedValue('wamid');
    const alert = jest.fn().mockResolvedValue(undefined);
    const submit = jest.fn().mockResolvedValue('efi-request');
    const scheduled = jest.fn().mockResolvedValue(undefined);
    const workflow = new OnboardingWorkflow(
      prisma,
      crypto,
      { createAccount: submit } as unknown as EfiOpeningClient,
      { sendNotice: notice, alert } as unknown as OnboardingNotifications,
      { schedule: scheduled } as unknown as OnboardingJobs,
    );
    return { workflow, row, notice, submit, scheduled, alert };
  }

  it('accepts the Meta notice before a single Efí submission and persists its identifier', async () => {
    const { workflow, row, notice, submit } = fixture();
    await workflow.submit('tenant');
    expect(notice).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(notice.mock.invocationCallOrder[0]).toBeLessThan(
      submit.mock.invocationCallOrder[0] as number,
    );
    expect(row.status).toBe('AWAITING_REPRESENTATIVE');
    expect(row.simplifiedAccountRequestId).toBe('efi-request');
    await workflow.submit('tenant');
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('never calls Efí while WhatsApp fails and exhausts the three delayed retries', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-09T12:00:00Z') });
    const { workflow, row, notice, submit, scheduled } = fixture();
    notice.mockRejectedValue(new Error('temporary'));
    for (let attempt = 0; attempt < 4; attempt++) {
      await workflow.submit('tenant');
      jest.setSystemTime(
        Date.now() + ([300_000, 1800_000, 7200_000, 0][attempt] ?? 0),
      );
    }
    expect(submit).not.toHaveBeenCalled();
    expect(row.status).toBe('CORRECTION_REQUIRED');
    const delays = scheduled.mock.calls.map(
      (call: unknown[]): unknown => call[3],
    );
    expect(delays).toEqual([300_000, 1800_000, 7200_000]);
  });

  it('ignores an early retry until the persisted notice deadline', async () => {
    const { workflow, notice } = fixture();
    notice.mockRejectedValue(new Error('temporary'));
    await workflow.submit('tenant');
    await workflow.submit('tenant');
    expect(notice).toHaveBeenCalledTimes(1);
  });

  it('ignores stale jobs from a prior draft revision', async () => {
    const { workflow, notice, submit } = fixture();
    await workflow.submit('tenant', 0);
    expect(notice).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('persists ambiguous submission state and never retries the Efí POST', async () => {
    const { workflow, row, submit, alert } = fixture();
    submit.mockRejectedValue(
      new EfiOpeningError('EFI_SUBMISSION_UNCERTAIN', true),
    );
    await workflow.submit('tenant');
    await workflow.submit('tenant');
    expect(row.status).toBe('SUBMISSION_UNCERTAIN');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalled();
  });

  it('requires correction for known functional errors without exposing provider data', async () => {
    const { workflow, row, submit } = fixture();
    submit.mockRejectedValue(new EfiOpeningError('cnpj_invalido', false, 400));
    await workflow.submit('tenant');
    expect(row.status).toBe('CORRECTION_REQUIRED');
    expect(row.sanitizedErrorMessage).toContain('CNPJ');
  });

  it('blocks expired sensitive data before any provider call', async () => {
    const { workflow, row, notice, submit } = fixture();
    row.sensitiveDataExpiresAt = new Date(0);
    await workflow.submit('tenant');
    expect(row.status).toBe('CORRECTION_REQUIRED');
    expect(notice).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
});
