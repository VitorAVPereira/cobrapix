import { DatafyRateLimitService } from '../../whatsapp/transport/datafy-rate-limit.service';
import { ConfigService } from '@nestjs/config';
import {
  MessagingLimitService,
  parseChannelTier,
} from './messaging-limit.service';
import { DatafyTransport } from '../../whatsapp/transport/datafy.transport';
import type { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { WhatsappTransportError } from '../../whatsapp/transport/whatsapp-transport.error';

const testQuota = {
  acquire: jest.fn().mockResolvedValue(undefined),
} as unknown as DatafyRateLimitService;

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    status: 'ready',
    on: jest.fn(),
    quit: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
  })),
}));

const HOUR = 3_600_000;
const channelConfig = () =>
  new ConfigService({
    DATAFY_API_TOKEN: 'sk_live_test',
    META_PHONE_NUMBER_ID: '123',
    META_BUSINESS_ACCOUNT_ID: '456',
  });

function redisMock(value: string | null = null, ready = true) {
  return {
    status: ready ? 'ready' : 'end',
    get: ready
      ? jest.fn().mockResolvedValue(value)
      : jest.fn().mockRejectedValue(new Error('Connection is closed.')),
    setex: jest.fn().mockResolvedValue('OK'),
  };
}

function withRedis(
  service: MessagingLimitService,
  redis: ReturnType<typeof redisMock>,
) {
  Object.assign(service, { redis });
  return service;
}

const verified = (tier: string, ageMs = HOUR) =>
  JSON.stringify({
    tier,
    checkedAt: new Date(Date.now() - ageMs).toISOString(),
  });

describe('parseChannelTier', () => {
  it.each([
    ['TIER_50', 50],
    ['TIER_250', 250],
    ['TIER_1K', 1_000],
    ['TIER_2K', 2_000],
    ['TIER_10K', 10_000],
    ['TIER_100K', 100_000],
    ['tier_2k', 2_000],
  ])('reads %s as %s unique recipients', (raw, limit) => {
    expect(parseChannelTier(raw)).toEqual({
      tier: raw.toUpperCase(),
      limit,
    });
  });

  it('keeps the unlimited tier as the only unlimited value', () => {
    expect(parseChannelTier('TIER_UNLIMITED')).toEqual({
      tier: 'TIER_UNLIMITED',
      limit: null,
    });
  });

  it.each([
    'BUSINESS_VERIFIED',
    'VERIFIED_UNLIMITED_ACCESS',
    '10K',
    'TIER_5K',
    '',
    42,
    null,
  ])('does not infer a tier from %p', (raw) => {
    expect(parseChannelTier(raw)).toBeNull();
  });
});

describe('Consulta do tier do canal compartilhado', () => {
  afterEach(() => jest.restoreAllMocks());

  function service(prisma: Partial<Record<string, unknown>> = {}) {
    const config = channelConfig();
    return new MessagingLimitService(
      config,
      {
        $queryRaw: jest
          .fn()
          .mockResolvedValue([{ used: 3n, known: false, oldest: new Date() }]),
        company: { update: jest.fn() },
        ...prisma,
      } as unknown as PrismaService,
      new DatafyTransport(config, testQuota),
    );
  }

  it('reads the portfolio limit field through Datafy and caches it with its time', async () => {
    const http = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ phone_number_id: '123', waba_id: '456' }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: '123',
            whatsapp_business_manager_messaging_limit: 'TIER_2K',
          }),
        ),
      );
    const redis = redisMock();
    const limits = withRedis(service(), redis);
    // What was cached is what the enforcement reads back.
    redis.get.mockImplementation(() => {
      const calls = redis.setex.mock.calls as Array<[string, number, string]>;
      return Promise.resolve(calls[0]?.[2] ?? null);
    });
    const result = await limits.syncChannelTier();
    expect(result.tier).toBe('TIER_2K');
    expect(result.capacity).toMatchObject({
      source: 'PROVIDER',
      tier: 'TIER_2K',
      limit: 2_000,
      used: 3,
      remaining: 1_997,
      scopeId: 'channel:123',
    });
    expect(http).toHaveBeenLastCalledWith(
      'https://cloud.datafyapi.com.br/v1/123?fields=id,whatsapp_business_manager_messaging_limit',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(redis.setex).toHaveBeenCalledWith(
      'ciframais:channel-tier:123',
      86_400,
      expect.stringContaining('"checkedAt"'),
    );
  });

  it('falls back to the deprecated field when the provider refuses the new one', async () => {
    const http = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ phone_number_id: '123', waba_id: '456' }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 100 } }), { status: 400 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: '123', messaging_limit_tier: 'TIER_1K' }),
        ),
      );
    const limits = withRedis(service(), redisMock());
    await expect(limits.syncChannelTier()).resolves.toMatchObject({
      tier: 'TIER_1K',
    });
    expect(http).toHaveBeenLastCalledWith(
      'https://cloud.datafyapi.com.br/v1/123?fields=id,messaging_limit_tier',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('keeps an unexpected format unknown and caches nothing', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ phone_number_id: '123', waba_id: '456' }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: '123',
            whatsapp_business_manager_messaging_limit: { max: 2000 },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: '123',
            messaging_limit_tier: 'BUSINESS_VERIFIED',
          }),
        ),
      );
    const redis = redisMock();
    const result = await withRedis(service(), redis).syncChannelTier();
    expect(result.tier).toBeNull();
    expect(result.capacity).toMatchObject({ source: 'FALLBACK', limit: 50 });
    expect(redis.setex).not.toHaveBeenCalled();
  });

  it('reports a provider failure without claiming a tier', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 503 }));
    const result = await withRedis(service(), redisMock()).syncChannelTier();
    expect(result.tier).toBeNull();
    expect(result.capacity.source).toBe('FALLBACK');
  });
});

describe('Capacidade do canal central (admin)', () => {
  function service(
    redis: ReturnType<typeof redisMock>,
    usage: { used: bigint; oldest: Date | null } | Error = {
      used: 3n,
      oldest: new Date(Date.now() - 2 * HOUR),
    },
    config = channelConfig(),
  ) {
    const $queryRaw =
      usage instanceof Error
        ? jest.fn().mockRejectedValue(usage)
        : jest.fn().mockResolvedValue([{ ...usage, known: false }]);
    const limits = new MessagingLimitService(
      config,
      { $queryRaw } as unknown as PrismaService,
      {} as DatafyTransport,
    );
    return { limits: withRedis(limits, redis), $queryRaw };
  }

  it('shows a verified tier with its verification time and usage', async () => {
    const { limits } = service(redisMock(verified('TIER_1K')));
    await expect(limits.getChannelCapacity()).resolves.toMatchObject({
      source: 'VERIFIED_CACHE',
      tier: 'TIER_1K',
      limit: 1_000,
      used: 3,
      remaining: 997,
      unit: 'UNIQUE_RECIPIENTS',
      windowSeconds: 86_400,
      scopeId: 'channel:123',
      checkedAt: expect.any(String) as unknown,
      nextAvailableAt: null,
    });
  });

  it('treats a verification older than 24 h as absent', async () => {
    const { limits } = service(redisMock(verified('TIER_10K', 25 * HOUR)));
    await expect(limits.getChannelCapacity()).resolves.toMatchObject({
      source: 'FALLBACK',
      tier: null,
      limit: 50,
      checkedAt: null,
    });
  });

  it('labels the local conservative limit as fallback, not as the account limit', async () => {
    const { limits } = service(redisMock(null));
    await expect(limits.getChannelCapacity()).resolves.toMatchObject({
      source: 'FALLBACK',
      limit: 50,
      tier: null,
    });
  });

  it('keeps a legacy cached label valid', async () => {
    const { limits } = service(redisMock('TIER_250'));
    await expect(limits.getChannelCapacity()).resolves.toMatchObject({
      source: 'VERIFIED_CACHE',
      limit: 250,
      checkedAt: null,
    });
  });

  it('reports an unlimited tier without a fake number', async () => {
    const { limits } = service(redisMock(verified('TIER_UNLIMITED')));
    await expect(limits.getChannelCapacity()).resolves.toMatchObject({
      source: 'VERIFIED_CACHE',
      limit: null,
      remaining: null,
      used: 3,
    });
  });

  it('gives the moment the next unit frees only when exhausted', async () => {
    const oldest = new Date(Date.now() - 20 * HOUR);
    const { limits } = service(redisMock(verified('TIER_50')), {
      used: 50n,
      oldest,
    });
    const capacity = await limits.getChannelCapacity();
    expect(capacity.remaining).toBe(0);
    expect(capacity.nextAvailableAt).toBe(
      new Date(oldest.getTime() + 24 * HOUR).toISOString(),
    );
  });

  it.each([
    ['Redis is down', redisMock(null, false), undefined],
    [
      'the database fails',
      redisMock(verified('TIER_1K')),
      new Error('timeout'),
    ],
  ])(
    'reports an unknown state when %s, never unlimited',
    async (_case, redis, usage) => {
      const { limits } = service(redis, usage);
      await expect(limits.getChannelCapacity()).resolves.toEqual({
        limit: null,
        used: null,
        remaining: null,
        unit: 'UNIQUE_RECIPIENTS',
        windowSeconds: null,
        scopeId: 'channel:123',
        source: 'UNAVAILABLE',
        tier: null,
        checkedAt: null,
        nextAvailableAt: null,
      });
    },
  );

  it('reports an unconfigured channel as unavailable', async () => {
    const { limits, $queryRaw } = service(
      redisMock(null),
      undefined,
      new ConfigService({}),
    );
    await expect(limits.getChannelCapacity()).resolves.toMatchObject({
      source: 'UNAVAILABLE',
      scopeId: 'channel:unconfigured',
    });
    expect($queryRaw).not.toHaveBeenCalled();
  });
});

describe('Reserva da capacidade do canal', () => {
  function reservation(
    options: {
      redis?: ReturnType<typeof redisMock>;
      usage?: { used: bigint; known: boolean; oldest: Date | null };
      reservedAt?: Date | null;
    } = {},
  ) {
    const intent = {
      id: 'intent',
      companyId: 'company-1',
      recipientHash: 'hash-a',
      quotaReservedAt: options.reservedAt ?? null,
    };
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest
        .fn()
        .mockResolvedValue([
          options.usage ?? { used: 1n, known: false, oldest: new Date() },
        ]),
      communicationOutboundIntent: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(intent),
        update: jest.fn().mockResolvedValue(intent),
      },
      company: { findUniqueOrThrow: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) =>
        fn(tx),
      ),
    };
    const limits = withRedis(
      new MessagingLimitService(
        channelConfig(),
        prisma as unknown as PrismaService,
        {} as DatafyTransport,
      ),
      options.redis ?? redisMock(null),
    );
    return { limits, tx, prisma };
  }

  it('lets a company with a low old tier send while the channel has capacity', async () => {
    const { limits, tx } = reservation({
      usage: { used: 49n, known: false, oldest: new Date() },
    });
    await limits.reserveDispatchQuota('intent', '123');
    expect(tx.company.findUniqueOrThrow).not.toHaveBeenCalled();
    const sql = (tx.$queryRaw.mock.calls[0] as [Prisma.Sql])[0].sql;
    expect(sql).not.toContain('companyId');
    expect(sql).not.toContain('MessagingUsage');
    expect(tx.communicationOutboundIntent.update).toHaveBeenCalledWith({
      where: { id: 'intent' },
      data: { quotaReservedAt: expect.any(Date) as unknown },
    });
  });

  it('holds any company once the central capacity is used, until a unit frees', async () => {
    const oldest = new Date(Date.now() - 23.5 * HOUR);
    const { limits, tx } = reservation({
      usage: { used: 50n, known: false, oldest },
    });
    const error = (await limits
      .reserveDispatchQuota('intent', '123')
      .catch((caught: unknown) => caught)) as WhatsappTransportError;
    expect(error).toBeInstanceOf(WhatsappTransportError);
    expect(error).toMatchObject({
      kind: 'RATE_LIMIT',
      outcome: 'NOT_SENT',
      reasonCode: 'CHANNEL_CAPACITY_EXHAUSTED',
    });
    // Waits until the oldest recipient leaves the window, never an immediate loop.
    expect(error.retryAfterSeconds).toBeGreaterThanOrEqual(1_700);
    expect(error.retryAfterSeconds).toBeLessThanOrEqual(1_800);
    expect(tx.communicationOutboundIntent.update).not.toHaveBeenCalled();
  });

  it('bounds the wait between one minute and one hour', async () => {
    const soon = reservation({
      usage: {
        used: 50n,
        known: false,
        oldest: new Date(Date.now() - 24 * HOUR + 1_000),
      },
    });
    await expect(
      soon.limits.reserveDispatchQuota('intent', '123'),
    ).rejects.toMatchObject({ retryAfterSeconds: 60 });
    const later = reservation({
      usage: { used: 50n, known: false, oldest: new Date() },
    });
    await expect(
      later.limits.reserveDispatchQuota('intent', '123'),
    ).rejects.toMatchObject({ retryAfterSeconds: 3_600 });
  });

  it('does not count a recipient already reached in the window again', async () => {
    const { limits, tx } = reservation({
      usage: { used: 50n, known: true, oldest: new Date() },
    });
    await limits.reserveDispatchQuota('intent', '123');
    expect(tx.communicationOutboundIntent.update).toHaveBeenCalled();
  });

  it('never consumes a second unit for a retry of the same intent', async () => {
    const { limits, tx } = reservation({
      reservedAt: new Date(Date.now() - HOUR),
      usage: { used: 50n, known: false, oldest: new Date() },
    });
    await limits.reserveDispatchQuota('intent', '123');
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.communicationOutboundIntent.update).not.toHaveBeenCalled();
  });

  it('counts a reservation older than the window as a new unit', async () => {
    const { limits, tx } = reservation({
      reservedAt: new Date(Date.now() - 25 * HOUR),
    });
    await limits.reserveDispatchQuota('intent', '123');
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.communicationOutboundIntent.update).toHaveBeenCalled();
  });

  it('applies a verified tier instead of the fallback', async () => {
    const { limits, tx } = reservation({
      redis: redisMock(verified('TIER_1K')),
      usage: { used: 500n, known: false, oldest: new Date() },
    });
    await limits.reserveDispatchQuota('intent', '123');
    expect(tx.communicationOutboundIntent.update).toHaveBeenCalled();
  });

  it('reserves without counting on an unlimited tier', async () => {
    const { limits, tx } = reservation({
      redis: redisMock(verified('TIER_UNLIMITED')),
    });
    await limits.reserveDispatchQuota('intent', '123');
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.communicationOutboundIntent.update).toHaveBeenCalled();
  });

  it('skips the reservation for sends that do not consume capacity', async () => {
    const { limits, prisma } = reservation();
    await limits.reserveDispatchQuota('intent', '123', {
      consumesCapacity: false,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('keeps the intent pending while Redis cannot be read', async () => {
    const { limits, prisma } = reservation({ redis: redisMock(null, false) });
    await expect(
      limits.reserveDispatchQuota('intent', '123'),
    ).rejects.toMatchObject({
      kind: 'TEMPORARY',
      outcome: 'NOT_SENT',
      retryAfterSeconds: 5,
      reasonCode: 'CHANNEL_CONTROL_UNAVAILABLE',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  describe('failures of the reservation itself', () => {
    const limits = (error: unknown): MessagingLimitService =>
      withRedis(
        new MessagingLimitService(
          new ConfigService({}),
          {
            $transaction: jest.fn().mockRejectedValue(error),
          } as unknown as PrismaService,
          {} as DatafyTransport,
        ),
        redisMock(null),
      );

    it('keeps the intent pending on a transient database failure', async () => {
      await expect(
        limits(new Error('connection reset')).reserveDispatchQuota(
          'intent',
          '123',
        ),
      ).rejects.toMatchObject({ kind: 'TEMPORARY', outcome: 'NOT_SENT' });
    });

    it('rejects instead of looping when the intent no longer exists', async () => {
      const missing = new Prisma.PrismaClientKnownRequestError('not found', {
        code: 'P2025',
        clientVersion: 'test',
      });
      const error: unknown = await limits(missing)
        .reserveDispatchQuota('intent', '123')
        .catch((reason: unknown) => reason);
      expect(error).not.toBeInstanceOf(WhatsappTransportError);
      expect(error).toMatchObject({ message: 'DISPATCH_CONTEXT_NOT_FOUND' });
    });
  });
});

describe('Consumo das ultimas 24 h', () => {
  it('conta status Datafy das mensagens da empresa no canal WhatsApp', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      { status: 'pending', _count: { _all: 4 } },
      { status: 'sent', _count: { _all: 3 } },
      { status: 'delivered', _count: { _all: 2 } },
      { status: 'read', _count: { _all: 5 } },
      { status: 'failed', _count: { _all: 1 } },
      { status: 'delivery_uncertain', _count: { _all: 1 } },
      { status: null, _count: { _all: 6 } },
    ]);
    const count = jest.fn().mockResolvedValue(7);
    const config = new ConfigService({});
    const limits = new MessagingLimitService(
      config,
      { communicationMessage: { groupBy, count } } as unknown as PrismaService,
      new DatafyTransport(config, testQuota),
    );
    await expect(limits.getInteractionStats('company-1')).resolves.toEqual({
      outbound: 10,
      delivered: 7,
      read: 5,
      inbound: 7,
      failed: 1,
    });
    // Only the signed-in company: another company's messages never count.
    const scope = {
      companyId: 'company-1',
      conversation: { channel: 'WHATSAPP' },
      createdAt: { gte: expect.any(Date) as unknown },
    };
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['status'],
        where: { ...scope, direction: 'OUTBOUND' },
      }),
    );
    expect(count).toHaveBeenCalledWith({
      where: { ...scope, direction: 'INBOUND' },
    });
  });
});
