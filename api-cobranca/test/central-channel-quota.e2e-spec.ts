/**
 * Central WhatsApp channel capacity on a disposable PostgreSQL + Redis
 * (node test/e2e-disposable.cjs central-channel-quota.e2e-spec.ts). The
 * transport is not called: the reservation that precedes it is exercised by
 * several service instances (own connection pools) at once.
 */
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import Redis from 'ioredis';
import { PrismaService } from '../src/prisma/prisma.service';
import { MessagingLimitService } from '../src/queue/services/messaging-limit.service';
import type { WhatsappTransport } from '../src/whatsapp/transport/whatsapp-transport';

jest.setTimeout(120_000);
if (
  !process.env.CIFRAMAIS_DISPOSABLE_E2E ||
  !/^postgresql:\/\/postgres:[a-f0-9]+@127\.0\.0\.1:\d+\/ciframais_e2e$/.test(
    process.env.DATABASE_URL ?? '',
  )
)
  throw new Error(
    'Execute com: node test/e2e-disposable.cjs central-channel-quota.e2e-spec.ts',
  );

const HOUR = 3_600_000;
const config = (overrides: Record<string, string> = {}) =>
  new ConfigService({
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_HOST: process.env.REDIS_HOST,
    REDIS_PORT: process.env.REDIS_PORT,
    META_PHONE_NUMBER_ID: '777',
    ...overrides,
  });

describe('Central channel capacity (PostgreSQL + Redis)', () => {
  const prisma = new PrismaService(config());
  const instances: Array<{
    prisma: PrismaService;
    limits: MessagingLimitService;
  }> = [];
  const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
  });
  let companyA = '';
  let companyB = '';
  let seq = 0;

  const hash = (phone: string) =>
    createHash('sha256').update(phone).digest('hex');

  // An intent as the dispatcher leaves it before transmission.
  async function intent(input: {
    companyId: string;
    phone: string;
    channel: string;
    reservedAt?: Date | null;
  }) {
    const recipientHash = hash(input.phone);
    const retentionExpiresAt = new Date(Date.now() + 365 * 86_400_000);
    const conversation = await prisma.communicationConversation.upsert({
      where: {
        channel_recipientHash: { channel: 'WHATSAPP', recipientHash },
      },
      create: {
        channel: 'WHATSAPP',
        recipientHash,
        recipientType: 'PHONE',
        retentionExpiresAt,
      },
      update: {},
    });
    const message = await prisma.communicationMessage.create({
      data: {
        conversationId: conversation.id,
        companyId: input.companyId,
        direction: 'OUTBOUND',
        content: 'template',
        retentionExpiresAt,
      },
    });
    return prisma.communicationOutboundIntent.create({
      data: {
        idempotencyKey: `quota-e2e:${++seq}:${randomBytes(4).toString('hex')}`,
        messageId: message.id,
        companyId: input.companyId,
        transport: 'DATAFY',
        transportChannelId: input.channel,
        recipientType: 'PHONE',
        recipientHash,
        recipientEncrypted: 'encrypted',
        requestHash: 'a'.repeat(64),
        retentionExpiresAt,
        quotaReservedAt: input.reservedAt ?? null,
      },
    });
  }

  async function fill(channel: string, count: number, reservedAt = new Date()) {
    for (let i = 0; i < count; i++)
      await intent({
        companyId: i % 2 ? companyB : companyA,
        phone: `55119${channel}${String(i).padStart(4, '0')}`,
        channel,
        reservedAt,
      });
  }

  const verifyTier = (channel: string, tier: string) =>
    redis.set(
      `ciframais:channel-tier:${channel}`,
      JSON.stringify({ tier, checkedAt: new Date().toISOString() }),
      'EX',
      86_400,
    );

  beforeAll(async () => {
    await prisma.$connect();
    const created = await Promise.all(
      ['A', 'B'].map((name, index) =>
        prisma.company.create({
          data: {
            corporateName: `Empresa ${name}`,
            email: `quota-${name.toLowerCase()}@example.test`,
            phoneNumber: `551199990000${index}`,
            document: `1234567800019${index}`,
            // An old per-company tier: it must no longer limit anything.
            messagingLimitTier: 'TIER_50',
          },
        }),
      ),
    );
    [companyA, companyB] = created.map((company) => company.id) as [
      string,
      string,
    ];
    for (let i = 0; i < 4; i++) {
      const own = new PrismaService(config());
      await own.$connect();
      instances.push({
        prisma: own,
        limits: new MessagingLimitService(
          config(),
          own,
          {} as WhatsappTransport,
        ),
      });
    }
  });

  afterAll(async () => {
    for (const { prisma: own, limits } of instances) {
      await limits.onModuleDestroy();
      await own.onModuleDestroy();
    }
    redis.disconnect();
    await prisma.onModuleDestroy();
  });

  it('lets a company past its old tier send while the channel has capacity', async () => {
    await verifyTier('101', 'TIER_1K');
    // 60 recipients of company A alone: above its old TIER_50.
    for (let i = 0; i < 60; i++)
      await intent({
        companyId: companyA,
        phone: `5511910${String(i).padStart(4, '0')}`,
        channel: '101',
        reservedAt: new Date(),
      });
    const next = await intent({
      companyId: companyA,
      phone: '5511919999999',
      channel: '101',
    });
    await instances[0]!.limits.reserveDispatchQuota(next.id, '101');
    const stored = await prisma.communicationOutboundIntent.findUniqueOrThrow({
      where: { id: next.id },
    });
    expect(stored.quotaReservedAt).not.toBeNull();
  });

  it('gives the last unit to one of many concurrent instances, from any company', async () => {
    await verifyTier('202', 'TIER_50');
    await fill('202', 49);
    const contenders = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        intent({
          companyId: i % 2 ? companyB : companyA,
          phone: `5511920${String(i).padStart(4, '0')}`,
          channel: '202',
        }),
      ),
    );
    const outcomes = await Promise.allSettled(
      contenders.map((candidate, i) =>
        instances[i % instances.length]!.limits.reserveDispatchQuota(
          candidate.id,
          '202',
        ),
      ),
    );
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    for (const outcome of outcomes)
      if (outcome.status === 'rejected')
        expect(outcome.reason).toMatchObject({
          kind: 'RATE_LIMIT',
          outcome: 'NOT_SENT',
          reasonCode: 'CHANNEL_CAPACITY_EXHAUSTED',
        });
    const reserved = await prisma.communicationOutboundIntent.count({
      where: { transportChannelId: '202', quotaReservedAt: { not: null } },
    });
    expect(reserved).toBe(50);
    await expect(
      instances[0]!.limits.getChannelCapacity(),
    ).resolves.toMatchObject({ scopeId: 'channel:777' });
  });

  it('never consumes a second unit for a retry, and a shared recipient costs nothing new', async () => {
    await verifyTier('303', 'TIER_50');
    await fill('303', 49);
    const first = await intent({
      companyId: companyA,
      phone: '5511930000001',
      channel: '303',
    });
    await instances[0]!.limits.reserveDispatchQuota(first.id, '303');
    const reservedAt = (
      await prisma.communicationOutboundIntent.findUniqueOrThrow({
        where: { id: first.id },
      })
    ).quotaReservedAt;
    // Retry of the same intent at a full channel.
    await Promise.all(
      instances.map(({ limits }) =>
        limits.reserveDispatchQuota(first.id, '303'),
      ),
    );
    expect(
      (
        await prisma.communicationOutboundIntent.findUniqueOrThrow({
          where: { id: first.id },
        })
      ).quotaReservedAt,
    ).toEqual(reservedAt);
    // The same person, now by company B: already reached in the window.
    const shared = await intent({
      companyId: companyB,
      phone: '5511930000001',
      channel: '303',
    });
    await instances[1]!.limits.reserveDispatchQuota(shared.id, '303');
    const stranger = await intent({
      companyId: companyB,
      phone: '5511930000002',
      channel: '303',
    });
    await expect(
      instances[2]!.limits.reserveDispatchQuota(stranger.id, '303'),
    ).rejects.toMatchObject({ reasonCode: 'CHANNEL_CAPACITY_EXHAUSTED' });
  });

  it('frees the units whose reservations left the 24 h window', async () => {
    await verifyTier('404', 'TIER_50');
    await fill('404', 50, new Date(Date.now() - 25 * HOUR));
    const next = await intent({
      companyId: companyB,
      phone: '5511940000001',
      channel: '404',
    });
    await instances[0]!.limits.reserveDispatchQuota(next.id, '404');
    await expect(
      prisma.communicationOutboundIntent.count({
        where: {
          transportChannelId: '404',
          quotaReservedAt: { gt: new Date(Date.now() - 24 * HOUR) },
        },
      }),
    ).resolves.toBe(1);
  });

  it('counts only its own channel, never a history without channel', async () => {
    await verifyTier('505', 'TIER_50');
    await fill('606', 50);
    await prisma.messagingUsage.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        companyId: companyA,
        phoneNumber: `5511950${String(i).padStart(4, '0')}`,
      })),
      skipDuplicates: true,
    });
    const next = await intent({
      companyId: companyA,
      phone: '5511959999999',
      channel: '505',
    });
    await instances[0]!.limits.reserveDispatchQuota(next.id, '505');
    expect(
      (
        await prisma.communicationOutboundIntent.findUniqueOrThrow({
          where: { id: next.id },
        })
      ).quotaReservedAt,
    ).not.toBeNull();
  });

  it('rolls a failed reservation back and keeps the intent pending', async () => {
    await verifyTier('707', 'TIER_50');
    const victim = await intent({
      companyId: companyA,
      phone: '5511970000001',
      channel: '707',
    });
    await prisma.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION e2e_fail_quota() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER e2e_fail_quota BEFORE UPDATE ON "CommunicationOutboundIntent" FOR EACH ROW WHEN (NEW.id = '${victim.id}') EXECUTE FUNCTION e2e_fail_quota()`,
    );
    try {
      await expect(
        instances[0]!.limits.reserveDispatchQuota(victim.id, '707'),
      ).rejects.toMatchObject({
        kind: 'TEMPORARY',
        outcome: 'NOT_SENT',
        reasonCode: 'CHANNEL_CONTROL_UNAVAILABLE',
      });
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER e2e_fail_quota ON "CommunicationOutboundIntent"`,
      );
    }
    expect(
      (
        await prisma.communicationOutboundIntent.findUniqueOrThrow({
          where: { id: victim.id },
        })
      ).quotaReservedAt,
    ).toBeNull();
    await instances[0]!.limits.reserveDispatchQuota(victim.id, '707');
  });

  it('holds sends while Redis is unreachable and resumes when it answers', async () => {
    const pending = await intent({
      companyId: companyA,
      phone: '5511980000001',
      channel: '808',
    });
    const cut = new MessagingLimitService(
      config({ REDIS_PORT: '1' }),
      prisma,
      {} as WhatsappTransport,
    );
    try {
      await expect(
        cut.reserveDispatchQuota(pending.id, '808'),
      ).rejects.toMatchObject({
        kind: 'TEMPORARY',
        reasonCode: 'CHANNEL_CONTROL_UNAVAILABLE',
      });
      await expect(cut.getChannelCapacity()).resolves.toMatchObject({
        source: 'UNAVAILABLE',
        limit: null,
      });
    } finally {
      await cut.onModuleDestroy();
    }
    await instances[0]!.limits.reserveDispatchQuota(pending.id, '808');
    expect(
      (
        await prisma.communicationOutboundIntent.findUniqueOrThrow({
          where: { id: pending.id },
        })
      ).quotaReservedAt,
    ).not.toBeNull();
  });
});
