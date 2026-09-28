import type { PrismaService } from '../prisma/prisma.service';
import type { PaymentCryptoService } from '../payment/payment-crypto.service';
import type { TemplatePendingService } from '../communications/template-pending.service';
import {
  BASE_MIGRATION,
  TRANSITION_MIGRATIONS,
  TemplateTransitionService,
} from './template-transition.service';

function setup(options: {
  migrations?: string[];
  channelEnabled?: boolean | null;
  sending?: number;
}) {
  const migrations = options.migrations ?? [
    BASE_MIGRATION,
    ...TRANSITION_MIGRATIONS,
  ];
  const prisma = {
    // Every table/column exists; the migrations table lists what was applied.
    $queryRaw: jest.fn().mockResolvedValue([{ count: 1 }]),
    $queryRawUnsafe: jest.fn((sql: string) =>
      Promise.resolve(
        sql.includes('_prisma_migrations')
          ? migrations.map((migration_name) => ({ migration_name }))
          : [{ count: 0 }],
      ),
    ),
    platformIntegrationState: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          options.channelEnabled === null
            ? null
            : { enabled: options.channelEnabled ?? false },
        ),
    },
    communicationOutboundIntent: {
      count: jest.fn().mockResolvedValue(options.sending ?? 0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(),
  };
  const pending = { block: jest.fn() };
  const service = new TemplateTransitionService(
    prisma as unknown as PrismaService,
    { decrypt: jest.fn() } as unknown as PaymentCryptoService,
    pending as unknown as TemplatePendingService,
  );
  return { service, prisma, pending };
}

describe('TemplateTransitionService.apply', () => {
  it('requires every migration of the feature', async () => {
    const { service, prisma } = setup({ migrations: [BASE_MIGRATION] });
    await expect(service.apply()).rejects.toThrow(/Aplique as migrations/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires the WhatsApp channel explicitly paused', async () => {
    for (const channelEnabled of [true, null]) {
      const { service, prisma } = setup({ channelEnabled });
      await expect(service.apply()).rejects.toThrow(/Pause o canal/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  });

  it('refuses while a send is in flight instead of touching it', async () => {
    const { service, prisma, pending } = setup({ sending: 2 });
    await expect(service.apply()).rejects.toThrow(/2 envio/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(pending.block).not.toHaveBeenCalled();
  });
});

describe('TemplateTransitionService.preflight', () => {
  it('reports without writing and flags a missing base migration and in-flight sends', async () => {
    const { service, prisma } = setup({ migrations: [] });
    prisma.$queryRawUnsafe.mockImplementation((sql: string) =>
      Promise.resolve(
        sql.includes('_prisma_migrations')
          ? []
          : sql.includes(`'SENDING'`)
            ? [{ count: 1 }]
            : [{ count: 0 }],
      ),
    );
    const report = await service.preflight();
    expect(report.canApply).toBe(false);
    expect(report.blockers).toEqual([
      expect.stringContaining(BASE_MIGRATION),
      expect.stringContaining('1 envio(s) em andamento'),
    ]);
    expect(report.counts.pendingMigrations).toBe(TRANSITION_MIGRATIONS.length);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    for (const [sql] of prisma.$queryRawUnsafe.mock.calls as Array<[string]>)
      expect(sql.trim()).toMatch(/^SELECT/);
  });
});

describe('TemplateTransitionService.verify', () => {
  it('stops at pending migrations', async () => {
    const { service } = setup({ migrations: [BASE_MIGRATION] });
    await expect(service.verify()).resolves.toMatchObject({
      ok: false,
      violations: [expect.stringContaining('Migrations pendentes')],
    });
  });
});
