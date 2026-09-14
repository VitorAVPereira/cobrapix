import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { OnboardingJobs } from './onboarding-jobs';
import { OnboardingNotifications } from './onboarding-notifications';
import { OnboardingMaintenance } from './onboarding-maintenance';

describe('onboarding maintenance', () => {
  function fixture(status = 'AWAITING_REPRESENTATIVE'): {
    service: OnboardingMaintenance;
    row: Record<string, unknown>;
    schedule: jest.Mock;
    sendReminder: jest.Mock;
    alert: jest.Mock;
  } {
    const row: Record<string, unknown> = {
      id: 'onboarding',
      companyId: 'tenant',
      status,
      draftRevision: 1,
      submittedAt: new Date(Date.now() - 8 * 86400_000),
      lastProgressAt: new Date(Date.now() - 8 * 86400_000),
      representativePhoneEncrypted: 'encrypted',
      sensitiveDataExpiresAt: new Date(Date.now() + 86400_000),
      noticeAttempts: 1,
      provisioningAttempts: 0,
      reminderAttempts: 0,
      company: { corporateName: 'Company' },
    };
    const model = {
      findMany: jest.fn().mockResolvedValue([row]),
      findUnique: jest.fn().mockResolvedValue(row),
      updateMany: jest.fn(
        (input: {
          data: Record<string, unknown>;
        }): Promise<{ count: number }> => {
          Object.assign(row, input.data);
          return Promise.resolve({ count: 1 });
        },
      ),
    };
    const schedule = jest.fn().mockResolvedValue(undefined);
    const sendReminder = jest.fn().mockResolvedValue('accepted');
    const alert = jest.fn().mockResolvedValue(undefined);
    return {
      row,
      schedule,
      sendReminder,
      alert,
      service: new OnboardingMaintenance(
        { efiOnboarding: model } as unknown as PrismaService,
        {
          decrypt: (): string => '5511999999999',
        } as unknown as PaymentCryptoService,
        { schedule } as unknown as OnboardingJobs,
        { sendReminder, alert } as unknown as OnboardingNotifications,
      ),
    };
  }
  it('recovers persisted notice work using the revision and retry deadline', async () => {
    const { service, row, schedule } = fixture('NOTICE_PENDING');
    row.provisioningCheckpoint = {
      noticeRetryAt: new Date(Date.now() + 300_000).toISOString(),
    };
    await service.recover();
    expect(schedule).toHaveBeenCalledWith(
      'tenant',
      'submit',
      101,
      expect.any(Number),
      true,
    );
    const calls = schedule.mock.calls as unknown[][];
    expect(calls[0]?.[3]).toBeGreaterThan(290_000);
  });
  it('sends each due reminder once and ignores stale revision jobs', async () => {
    const { service, sendReminder, row } = fixture();
    await service.remind('tenant', 24);
    expect(sendReminder).not.toHaveBeenCalled();
    await service.remind('tenant', 124);
    await service.remind('tenant', 124);
    expect(sendReminder).toHaveBeenCalledTimes(1);
    expect(row.lastReminderAt).toBeInstanceOf(Date);
  });
  it('does not send reminders after approval', async () => {
    const { service, sendReminder } = fixture('PROVISIONING');
    await service.remind('tenant', 124);
    expect(sendReminder).not.toHaveBeenCalled();
  });
  it('alerts once for seven days without progress', async () => {
    const { service, alert } = fixture();
    await service.recover();
    await service.recover();
    expect(alert).toHaveBeenCalledTimes(1);
  });
});
