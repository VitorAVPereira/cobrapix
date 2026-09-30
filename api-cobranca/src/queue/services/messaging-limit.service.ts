import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MessagingLimitTier } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { WhatsappTransportError } from '../../whatsapp/transport/whatsapp-transport.error';
import type Redis from 'ioredis';
import { acquireRedis, releaseRedis } from '../../common/shared-redis';
import { PrismaService } from '../../prisma/prisma.service';
import { redisReady } from '../../common/redis-ready';
import { WHATSAPP_TRANSPORT } from '../../whatsapp/transport/whatsapp-transport';
import type { WhatsappTransport } from '../../whatsapp/transport/whatsapp-transport';

const TIER_LIMITS: Record<MessagingLimitTier, number> = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1_000,
  TIER_10K: 10_000,
  TIER_100K: 100_000,
  TIER_UNLIMITED: Number.MAX_SAFE_INTEGER,
};

interface DailyLimitStatus {
  allowed: boolean;
  remaining: number;
  limit: number;
  usage: number;
  tier: MessagingLimitTier;
}

// Meta messaging limit: unique users reached outside a customer service window
// in a moving 24 h period, set per business portfolio. This deployment sends
// from one number, so the channel (phone number id) is the reservation scope.
const CAPACITY_WINDOW_MS = 86_400_000;
// Existing conservative local limit, applied while no tier is verified. It is
// a protection, never presented as the account's confirmed limit.
const FALLBACK_CHANNEL_LIMIT = 50;
const CHANNEL_TIER_LIMITS: Record<string, number | null> = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1_000,
  TIER_2K: 2_000,
  TIER_10K: 10_000,
  TIER_100K: 100_000,
  TIER_UNLIMITED: null,
};

/**
 * `PROVIDER`: tier read from the provider now. `VERIFIED_CACHE`: tier read
 * earlier and still within 24 h. `FALLBACK`: no verified tier; the local
 * conservative limit applies. `UNAVAILABLE`: the control state is unknown.
 */
export type ChannelCapacitySource =
  | 'PROVIDER'
  | 'VERIFIED_CACHE'
  | 'FALLBACK'
  | 'UNAVAILABLE';

export interface CentralChannelCapacity {
  /** Enforced unique recipients per window; null when unlimited or unknown. */
  limit: number | null;
  used: number | null;
  remaining: number | null;
  unit: 'UNIQUE_RECIPIENTS';
  windowSeconds: number | null;
  scopeId: string;
  source: ChannelCapacitySource;
  tier: string | null;
  /** When the provider tier was read; null when not verified. */
  checkedAt: string | null;
  /** Only when exhausted: when the oldest counted recipient leaves the window. */
  nextAvailableAt: string | null;
}

interface ChannelLimit {
  limit: number | null;
  tier: string | null;
  source: 'VERIFIED_CACHE' | 'FALLBACK';
  checkedAt: string | null;
}

/** Exact provider labels only: "verified" or partial matches are not a tier. */
export function parseChannelTier(
  raw: unknown,
): { tier: string; limit: number | null } | null {
  if (typeof raw !== 'string') return null;
  const tier = raw.trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(CHANNEL_TIER_LIMITS, tier)
    ? { tier, limit: CHANNEL_TIER_LIMITS[tier] ?? null }
    : null;
}

@Injectable()
export class MessagingLimitService {
  private readonly logger = new Logger(MessagingLimitService.name);
  private readonly redis: Redis;

  constructor(
    private readonly config: ConfigService,
    private prisma: PrismaService,
    @Inject(WHATSAPP_TRANSPORT) private readonly transport: WhatsappTransport,
  ) {
    this.redis = acquireRedis(config);
  }

  getDailyLimit(tier: MessagingLimitTier | null): number {
    if (!tier) return TIER_LIMITS.TIER_50;
    return TIER_LIMITS[tier] ?? TIER_LIMITS.TIER_50;
  }

  async getDailyUsage(companyId: string): Promise<number> {
    const since = new Date(Date.now() - CAPACITY_WINDOW_MS);
    return this.prisma.messagingUsage.count({
      where: { companyId, sentAt: { gte: since } },
    });
  }

  /**
   * @deprecated Legacy fields of GET /whatsapp/usage, kept while older
   * frontends are replaced. The company tier no longer limits any send.
   */
  async canSend(companyId: string): Promise<DailyLimitStatus> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { messagingLimitTier: true },
    });

    const tier = company?.messagingLimitTier ?? 'TIER_50';
    const limit = this.getDailyLimit(tier);
    const usage = await this.getDailyUsage(companyId);
    const remaining = Math.max(0, limit - usage);

    return {
      allowed: remaining > 0,
      remaining,
      limit,
      usage,
      tier,
    };
  }

  /**
   * Reserves one unit of the central channel capacity before transmission.
   * There is no per-company quota: every company competes for the same
   * capacity. Only sends that can reach a user outside the service window
   * consume it (templates); in-window text replies do not.
   */
  async reserveDispatchQuota(
    intentId: string,
    channelId: string,
    options: { consumesCapacity: boolean } = { consumesCapacity: true },
  ): Promise<void> {
    if (!options.consumesCapacity) return;
    let channel: ChannelLimit;
    try {
      channel = await this.channelLimit(channelId);
    } catch {
      // Unknown control state never releases a send.
      throw new WhatsappTransportError(
        'Controle do canal indisponivel.',
        'TEMPORARY',
        'NOT_SENT',
        undefined,
        undefined,
        5,
        'CHANNEL_CONTROL_UNAVAILABLE',
      );
    }
    await this.prisma
      .$transaction(async (tx) => {
        // One shared-number lock coordinates reservations across companies and API processes.
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`dispatch-quota:${channelId}`}))`,
        );
        const intent = await tx.communicationOutboundIntent.findUniqueOrThrow({
          where: { id: intentId },
        });
        const since = new Date(Date.now() - CAPACITY_WINDOW_MS);
        // A retry of the same intent never consumes a second unit.
        if (intent.quotaReservedAt && intent.quotaReservedAt > since) return;
        if (channel.limit !== null) {
          const usage = await this.channelUsage(
            tx,
            channelId,
            since,
            intent.recipientHash,
          );
          // A recipient already reached in the window is not a new unit.
          if (!usage.known && usage.used >= channel.limit)
            throw new WhatsappTransportError(
              'Capacidade do canal central esgotada. O envio aguardara.',
              'RATE_LIMIT',
              'NOT_SENT',
              undefined,
              undefined,
              this.secondsUntil(usage.nextAvailableAt),
              'CHANNEL_CAPACITY_EXHAUSTED',
            );
        }
        await tx.communicationOutboundIntent.update({
          where: { id: intentId },
          data: { quotaReservedAt: new Date() },
        });
      })
      .catch((error: unknown) => {
        if (error instanceof WhatsappTransportError) throw error;
        // A missing intent/company or an invalid query never heals: reject instead of looping.
        if (
          (error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2025') ||
          error instanceof Prisma.PrismaClientValidationError
        )
          throw new Error('DISPATCH_CONTEXT_NOT_FOUND');
        // Nothing was transmitted: a database timeout or conflict keeps the intent pending.
        throw new WhatsappTransportError(
          'Controle do canal indisponivel.',
          'TEMPORARY',
          'NOT_SENT',
          undefined,
          undefined,
          5,
          'CHANNEL_CONTROL_UNAVAILABLE',
        );
      });
  }

  /**
   * Reads the channel tier from the provider (Datafy) and keeps it for 24 h as
   * the verified limit. Only the shared channel is affected, never a company.
   */
  async syncChannelTier(): Promise<{
    tier: string | null;
    capacity: CentralChannelCapacity;
  }> {
    let tier: string | null = null;
    let cached = false;
    try {
      const channel = await this.transport.getChannelInfo({
        includeMessagingLimit: true,
      });
      tier = parseChannelTier(channel.messagingLimitTier)?.tier ?? null;
      if (tier) {
        try {
          await this.redis.setex(
            this.tierCacheKey(channel.phoneNumberId),
            CAPACITY_WINDOW_MS / 1000,
            JSON.stringify({ tier, checkedAt: new Date().toISOString() }),
          );
          cached = true;
        } catch {
          /* The conservative fallback applies until a verified tier can be cached. */
        }
      }
    } catch {
      this.logger.warn(
        'Nao foi possivel consultar o tier do canal WhatsApp central.',
      );
    }
    const capacity = await this.getChannelCapacity();
    return {
      tier,
      capacity:
        cached && capacity.source === 'VERIFIED_CACHE'
          ? { ...capacity, source: 'PROVIDER' }
          : capacity,
    };
  }

  /**
   * Administrative view of the central channel: what is enforced, where the
   * value comes from and how much of the moving window is used. No recipient
   * data. Unknown states are reported as such, never as unlimited.
   */
  async getChannelCapacity(): Promise<CentralChannelCapacity> {
    const channelId = this.config.get<string>('META_PHONE_NUMBER_ID') ?? '';
    const unknown: CentralChannelCapacity = {
      limit: null,
      used: null,
      remaining: null,
      unit: 'UNIQUE_RECIPIENTS',
      windowSeconds: null,
      scopeId: /^\d{1,64}$/.test(channelId)
        ? `channel:${channelId}`
        : 'channel:unconfigured',
      source: 'UNAVAILABLE',
      tier: null,
      checkedAt: null,
      nextAvailableAt: null,
    };
    if (unknown.scopeId === 'channel:unconfigured') return unknown;
    try {
      const channel = await this.channelLimit(channelId);
      const usage = await this.channelUsage(
        this.prisma,
        channelId,
        new Date(Date.now() - CAPACITY_WINDOW_MS),
      );
      const remaining =
        channel.limit === null ? null : Math.max(0, channel.limit - usage.used);
      return {
        ...unknown,
        limit: channel.limit,
        used: usage.used,
        remaining,
        windowSeconds: CAPACITY_WINDOW_MS / 1000,
        source: channel.source,
        tier: channel.tier,
        checkedAt: channel.checkedAt,
        nextAvailableAt:
          remaining === 0 && usage.nextAvailableAt
            ? usage.nextAvailableAt.toISOString()
            : null,
      };
    } catch {
      return unknown;
    }
  }

  // The enforced limit: a verified tier from the last 24 h, or the local
  // conservative fallback. Throws when the control state cannot be read.
  private async channelLimit(channelId: string): Promise<ChannelLimit> {
    await redisReady(this.redis);
    const raw = await this.redis.get(this.tierCacheKey(channelId));
    const cached = this.parseCachedTier(raw);
    if (cached)
      return {
        limit: cached.limit,
        tier: cached.tier,
        source: 'VERIFIED_CACHE',
        checkedAt: cached.checkedAt,
      };
    return {
      limit: FALLBACK_CHANNEL_LIMIT,
      tier: null,
      source: 'FALLBACK',
      checkedAt: null,
    };
  }

  // Current format: JSON with the verification time. Older entries hold only
  // the label; they still expire with the key's own 24 h TTL.
  private parseCachedTier(
    raw: string | null,
  ): { tier: string; limit: number | null; checkedAt: string | null } | null {
    if (!raw) return null;
    let label: unknown = raw;
    let checkedAt: string | null = null;
    if (raw.startsWith('{')) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        label = parsed.tier;
        checkedAt =
          typeof parsed.checkedAt === 'string' ? parsed.checkedAt : null;
      } catch {
        return null;
      }
      const checkedTime = checkedAt ? Date.parse(checkedAt) : NaN;
      if (
        !Number.isFinite(checkedTime) ||
        Date.now() - checkedTime > CAPACITY_WINDOW_MS
      )
        return null;
    }
    const parsed = parseChannelTier(label);
    return parsed ? { ...parsed, checkedAt } : null;
  }

  // Distinct recipients reserved on this channel in the window. A recipient
  // leaves the window 24 h after its latest reservation.
  private async channelUsage(
    client: Pick<Prisma.TransactionClient, '$queryRaw'>,
    channelId: string,
    since: Date,
    recipientHash: string | null = null,
  ): Promise<{ used: number; known: boolean; nextAvailableAt: Date | null }> {
    const rows = await client.$queryRaw<
      Array<{ used: bigint; known: boolean; oldest: Date | null }>
    >(Prisma.sql`
      SELECT count(*) AS used,
        coalesce(bool_or(recipient = ${recipientHash}), false) AS known,
        min(last) AS oldest
      FROM (
        SELECT "recipientHash" AS recipient, max("quotaReservedAt") AS last
        FROM "CommunicationOutboundIntent"
        WHERE "transportChannelId" = ${channelId} AND "quotaReservedAt" > ${since}
        GROUP BY "recipientHash"
      ) AS recent`);
    const row = rows[0];
    return {
      used: Number(row?.used ?? 0),
      known: Boolean(row?.known),
      nextAvailableAt: row?.oldest
        ? new Date(new Date(row.oldest).getTime() + CAPACITY_WINDOW_MS)
        : null,
    };
  }

  // Retry when the next unit frees, checked at least once an hour.
  private secondsUntil(moment: Date | null): number {
    if (!moment) return 3600;
    const seconds = Math.ceil((moment.getTime() - Date.now()) / 1000);
    return Math.min(3600, Math.max(60, seconds));
  }

  private tierCacheKey(channelId: string): string {
    return `ciframais:channel-tier:${channelId}`;
  }

  /**
   * Last 24 h of the company's WhatsApp messages, from the Datafy conversation
   * history (provider status of each outbound message, attributed inbound).
   */
  async getInteractionStats(companyId: string): Promise<{
    outbound: number;
    delivered: number;
    read: number;
    inbound: number;
    failed: number;
  }> {
    const where = {
      companyId,
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      conversation: { channel: 'WHATSAPP' as const },
    };
    const [outbound, inbound] = await Promise.all([
      this.prisma.communicationMessage.groupBy({
        by: ['status'],
        where: { ...where, direction: 'OUTBOUND' },
        _count: { _all: true },
      }),
      this.prisma.communicationMessage.count({
        where: { ...where, direction: 'INBOUND' },
      }),
    ]);
    const count = (...statuses: string[]): number =>
      outbound
        .filter((row) => row.status !== null && statuses.includes(row.status))
        .reduce((total, row) => total + row._count._all, 0);
    return {
      outbound: count('sent', 'delivered', 'read'),
      delivered: count('delivered', 'read'),
      read: count('read'),
      inbound,
      failed: count('failed'),
    };
  }

  async onModuleDestroy(): Promise<void> {
    await releaseRedis(this.redis);
  }
}
