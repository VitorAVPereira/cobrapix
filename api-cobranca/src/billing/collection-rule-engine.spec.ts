import type { PrismaService } from '../prisma/prisma.service';
import {
  CollectionRuleEngine,
  ruleContacts,
  type ContactInvoice,
} from './collection-rule-engine';

type Status =
  | 'QUEUED'
  | 'SENT'
  | 'FAILED'
  | 'BLOCKED'
  | 'SKIPPED'
  | 'DELIVERED';
interface Attempt {
  ruleStepId: string;
  channel: string;
  status: Status;
  errorDetails?: string;
  createdAt: Date;
}

/** In-memory stand-in for the tables the engine reads and writes. */
function fakeDb(now: () => Date) {
  const attempts: Attempt[] = [];
  const intents: Array<{ createdAt: Date; state: string }> = [];
  const emissionEmails: Date[] = [];
  const logs: Array<{ actionType: string; description: string }> = [];
  const notIn = (status: string, where: { status?: { notIn: string[] } }) =>
    !where.status?.notIn.includes(status);
  const db = {
    collectionAttempt: {
      findMany: jest.fn(
        ({ where }: { where: { ruleStepId: { in: string[] } } }) =>
          Promise.resolve(
            attempts.filter((a) => where.ruleStepId.in.includes(a.ruleStepId)),
          ),
      ),
      findFirst: jest.fn(
        ({
          where,
        }: {
          where: { status?: { notIn: string[] }; createdAt?: { gte: Date } };
        }) =>
          Promise.resolve(
            attempts
              .filter((a) => notIn(a.status, where))
              .filter(
                (a) => !where.createdAt || a.createdAt >= where.createdAt.gte,
              )
              .sort(
                (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
              )[0] ?? null,
          ),
      ),
      count: jest.fn(({ where }: { where: { ruleStepId: { in: string[] } } }) =>
        Promise.resolve(
          attempts.filter((a) => where.ruleStepId.in.includes(a.ruleStepId))
            .length,
        ),
      ),
      createMany: jest.fn(
        ({ data }: { data: Array<Omit<Attempt, 'createdAt'>> }) => {
          for (const row of data)
            if (
              !attempts.some(
                (a) =>
                  a.ruleStepId === row.ruleStepId && a.channel === row.channel,
              )
            )
              attempts.push({ ...row, createdAt: now() });
          return Promise.resolve({ count: data.length });
        },
      ),
    },
    communicationOutboundIntent: {
      findFirst: jest.fn(
        ({ where }: { where: { state: { notIn: string[] } } }) =>
          Promise.resolve(
            intents
              .filter((i) => !where.state.notIn.includes(i.state))
              .sort(
                (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
              )[0] ?? null,
          ),
      ),
    },
    collectionLog: {
      findFirst: jest.fn(() =>
        Promise.resolve(
          emissionEmails.length
            ? {
                createdAt: emissionEmails.sort(
                  (a, b) => b.getTime() - a.getTime(),
                )[0],
              }
            : null,
        ),
      ),
      createMany: jest.fn(({ data }: { data: typeof logs }) => {
        logs.push(...data);
        return Promise.resolve({ count: data.length });
      }),
    },
    $executeRaw: jest.fn().mockResolvedValue(0),
  };
  const withTransaction = {
    ...db,
    $transaction: jest.fn((run: (tx: typeof db) => unknown) => run(db)),
  };
  return { db: withTransaction, attempts, intents, emissionEmails, logs };
}

const step = (
  id: string,
  stepOrder: number,
  channel: 'WHATSAPP' | 'EMAIL',
  delayDays: number,
  window: { sendTimeStart: string | null; sendTimeEnd: string | null } = {
    sendTimeStart: null,
    sendTimeEnd: null,
  },
) => ({ id, stepOrder, channel, delayDays, isActive: true, ...window });

/** São Paulo is UTC-3: 15:00 there is 18:00Z. */
const sp = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`);

function setup(
  steps: ReturnType<typeof step>[],
  invoice: Partial<ContactInvoice> = {},
) {
  let clock = sp('2026-10-20', '15:00');
  const fake = fakeDb(() => clock);
  const engine = new CollectionRuleEngine(fake.db as unknown as PrismaService);
  const target: ContactInvoice = {
    id: 'invoice-1',
    companyId: 'company-1',
    dueDate: new Date('2026-10-23T00:00:00Z'),
    createdAt: sp('2026-10-20', '15:00'),
    recurringInvoiceId: null,
    debtor: { collectionProfile: { steps } },
    ...invoice,
  };
  return {
    ...fake,
    engine,
    invoice: target,
    at: (date: string, time: string) => {
      clock = sp(date, time);
      return clock;
    },
  };
}

describe('ruleContacts', () => {
  it('groups the channels of a day into one contact and leaves "Inicial" steps out', () => {
    expect(
      ruleContacts([
        step('inicial', 0, 'EMAIL', -30),
        step('d-2-email', 1, 'EMAIL', 28),
        step('d-2-whatsapp', 2, 'WHATSAPP', 0),
        step('d0', 3, 'WHATSAPP', 2),
      ]),
    ).toEqual([
      {
        day: -2,
        steps: [
          { ruleStepId: 'd-2-email', channel: 'EMAIL' },
          { ruleStepId: 'd-2-whatsapp', channel: 'WHATSAPP' },
        ],
      },
      { day: 0, steps: [{ ruleStepId: 'd0', channel: 'WHATSAPP' }] },
    ]);
  });
});

describe('CollectionRuleEngine.planContact', () => {
  it('waits 24 h after the emission message, then sends the reminder (20/10 → 21/10)', async () => {
    const t = setup([step('d-2', 0, 'WHATSAPP', -2)]);
    t.intents.push({ createdAt: sp('2026-10-20', '15:00'), state: 'ACCEPTED' });

    await expect(
      t.engine.planContact(t.invoice, t.at('2026-10-21', '09:00')),
    ).resolves.toEqual({
      kind: 'WAIT',
      reason: 'MIN_INTERVAL',
    });
    await expect(
      t.engine.planContact(t.invoice, t.at('2026-10-21', '17:00')),
    ).resolves.toEqual({
      kind: 'SEND',
      contact: { day: -2, steps: [{ ruleStepId: 'd-2', channel: 'WHATSAPP' }] },
      moment: 'BEFORE_DUE',
    });
  });

  it('only the most recent due contact is sent; older ones are recorded as skipped', async () => {
    const t = setup([
      step('d-1', 0, 'WHATSAPP', -1),
      step('d0', 1, 'EMAIL', 1),
    ]);
    const plan = await t.engine.planContact(
      t.invoice,
      t.at('2026-10-23', '09:00'),
    );

    expect(plan).toMatchObject({
      kind: 'SEND',
      contact: { day: 0 },
      moment: 'DUE_TODAY',
    });
    expect(t.attempts).toEqual([
      expect.objectContaining({
        ruleStepId: 'd-1',
        status: 'SKIPPED',
        errorDetails: 'Substituída por uma etapa mais recente.',
      }),
    ]);
  });

  it('a reminder dated before the invoice was registered is never sent', async () => {
    const t = setup([step('d-5', 0, 'WHATSAPP', -5)]);
    await expect(
      t.engine.planContact(t.invoice, t.at('2026-10-21', '09:00')),
    ).resolves.toEqual({
      kind: 'NONE',
    });
    expect(t.attempts).toEqual([
      expect.objectContaining({
        ruleStepId: 'd-5',
        status: 'SKIPPED',
        errorDetails: 'Data anterior ao cadastro da fatura.',
      }),
    ]);
  });

  it('a reminder that waited until the due date reads "Vence hoje"', async () => {
    const t = setup([step('d-1', 0, 'WHATSAPP', -1)]);
    t.intents.push({ createdAt: sp('2026-10-22', '17:00'), state: 'ACCEPTED' });
    await expect(
      t.engine.planContact(t.invoice, t.at('2026-10-23', '17:00')),
    ).resolves.toMatchObject({
      kind: 'SEND',
      contact: { day: -1 },
      moment: 'DUE_TODAY',
    });
  });

  it('after the due date: first overdue, then critical; a failed or held one does not count', async () => {
    const t = setup([
      step('d1', 0, 'WHATSAPP', 1),
      step('d3', 1, 'WHATSAPP', 2),
    ]);
    await expect(
      t.engine.planContact(t.invoice, t.at('2026-10-24', '09:00')),
    ).resolves.toMatchObject({
      moment: 'FIRST_OVERDUE',
    });
    t.attempts.push({
      ruleStepId: 'd1',
      channel: 'WHATSAPP',
      status: 'FAILED',
      createdAt: sp('2026-10-24', '09:00'),
    });
    await expect(
      t.engine.planContact(t.invoice, t.at('2026-10-26', '09:00')),
    ).resolves.toMatchObject({
      contact: { day: 3 },
      moment: 'FIRST_OVERDUE',
    });
    t.attempts[0]!.status = 'DELIVERED';
    await expect(
      t.engine.planContact(t.invoice, t.at('2026-10-26', '09:00')),
    ).resolves.toMatchObject({
      contact: { day: 3 },
      moment: 'CRITICAL_OVERDUE',
    });
  });

  it('a recurring invoice always uses "Atraso recorrente" after the due date', async () => {
    const t = setup([step('d1', 0, 'WHATSAPP', 1)], {
      recurringInvoiceId: 'recurrence-1',
    });
    await expect(
      t.engine.planContact(t.invoice, t.at('2026-10-24', '09:00')),
    ).resolves.toMatchObject({
      moment: 'RECURRING_OVERDUE',
    });
  });

  it('respects the send window of the contact', async () => {
    const t = setup([
      step('d0', 0, 'WHATSAPP', 0, {
        sendTimeStart: '10:00',
        sendTimeEnd: '12:00',
      }),
    ]);
    await expect(
      t.engine.planContact(t.invoice, t.at('2026-10-23', '09:00')),
    ).resolves.toEqual({
      kind: 'WAIT',
      reason: 'SEND_WINDOW',
    });
  });

  it('"Inicial" steps of older profiles are history and never sent', async () => {
    const t = setup([step('inicial', 0, 'EMAIL', -30)]);
    await expect(
      t.engine.planContact(t.invoice, t.at('2026-10-20', '17:00')),
    ).resolves.toEqual({
      kind: 'NONE',
    });
    expect(t.attempts).toHaveLength(0);
  });
});

describe('CollectionRuleEngine.claimContact', () => {
  const claims = [
    {
      ruleStepId: 'd0-whatsapp',
      channel: 'WHATSAPP' as const,
      status: 'QUEUED' as const,
    },
    {
      ruleStepId: 'd0-email',
      channel: 'EMAIL' as const,
      status: 'QUEUED' as const,
    },
  ];

  it('records every channel of the contact once', async () => {
    const t = setup([]);
    await expect(
      t.engine.claimContact(t.invoice, claims, t.at('2026-10-23', '09:00')),
    ).resolves.toBe(true);
    expect(t.attempts.map((a) => a.ruleStepId)).toEqual([
      'd0-whatsapp',
      'd0-email',
    ]);
    // A concurrent run that reaches the same contact claims nothing.
    await expect(
      t.engine.claimContact(t.invoice, claims, t.at('2026-10-23', '09:00')),
    ).resolves.toBe(false);
    expect(t.db.$executeRaw).toHaveBeenCalled();
  });

  it('re-checks the 24 h inside the claim: another contact sent meanwhile wins', async () => {
    const t = setup([]);
    t.attempts.push({
      ruleStepId: 'd-1',
      channel: 'WHATSAPP',
      status: 'QUEUED',
      createdAt: sp('2026-10-22', '17:00'),
    });
    await expect(
      t.engine.claimContact(t.invoice, claims, t.at('2026-10-23', '09:00')),
    ).resolves.toBe(false);
    expect(t.attempts).toHaveLength(1);
  });
});
