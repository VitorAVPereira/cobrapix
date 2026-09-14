import { PrismaService } from '../prisma/prisma.service';
import { EfiOpeningClient } from './efi-opening.client';
import { OnboardingJobs } from './onboarding-jobs';
import { OnboardingEvents } from './onboarding-events';

describe('authenticated Efí event processing', () => {
  function fixture(): {
    events: OnboardingEvents;
    row: Record<string, unknown>;
    schedule: jest.Mock;
  } {
    const row: Record<string, unknown> = {
      id: 'onboard',
      companyId: 'tenant',
      simplifiedAccountRequestId: 'request',
      status: 'AWAITING_REPRESENTATIVE',
      draftRevision: 1,
    };
    const model = {
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
    const auditLog = { create: jest.fn().mockResolvedValue({}) };
    const prisma = {
      efiOnboarding: model,
      auditLog,
      $transaction: (
        callback: (tx: {
          efiOnboarding: typeof model;
          auditLog: typeof auditLog;
        }) => Promise<unknown>,
      ): Promise<unknown> => callback({ efiOnboarding: model, auditLog }),
    } as unknown as PrismaService;
    const schedule = jest.fn().mockResolvedValue(undefined);
    return {
      events: new OnboardingEvents(
        prisma,
        {
          getCredentials: jest.fn().mockResolvedValue({ active: true }),
        } as unknown as EfiOpeningClient,
        { schedule } as unknown as OnboardingJobs,
      ),
      row,
      schedule,
    };
  }
  it('queues provisioning once without activating the gateway on a webhook', async () => {
    const { events, row, schedule } = fixture();
    const payload = {
      evento: 'conta_aberta',
      contaSimplificada: { identificador: 'request' },
    };
    await events.handle(payload);
    await events.handle(payload);
    expect(row.status).toBe('PROVISIONING');
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith('tenant', 'provision', 101, 60_000);
  });
  it('records refusal with two full days of lock and clears consent', async () => {
    const { events, row } = fixture();
    const before = Date.now();
    await events.handle({
      evento: 'conta_recusada_pelo_cliente_final',
      contaSimplificada: { identificador: 'request' },
    });
    expect(row.status).toBe('REFUSED');
    expect((row.retryBlockedUntil as Date).getTime()).toBeGreaterThanOrEqual(
      before + 2 * 86400_000,
    );
    expect(row.consentAcceptedAt).toBeNull();
  });
  it('recovers missed approval through credential reconciliation', async () => {
    const { events, row, schedule } = fixture();
    await events.reconcile('tenant');
    expect(row.status).toBe('PROVISIONING');
    expect(schedule).toHaveBeenCalledTimes(1);
  });
  it('acknowledges an empty mTLS verification probe but rejects malformed callbacks', async () => {
    const { events } = fixture();
    await expect(events.handle({})).resolves.toBeUndefined();
    await expect(events.handle({ evento: 'conta_aberta' })).rejects.toThrow();
  });
});
