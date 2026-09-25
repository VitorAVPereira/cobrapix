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
  resetAt: number;
}

@Injectable()
export class MessagingLimitService {
  private readonly logger = new Logger(MessagingLimitService.name);
  private readonly redis: Redis;

  constructor(
    configService: ConfigService,
    private prisma: PrismaService,
    @Inject(WHATSAPP_TRANSPORT) private readonly transport: WhatsappTransport,
  ) {
    this.redis = acquireRedis(configService);
  }

  getDailyLimit(tier: MessagingLimitTier | null): number {
    if (!tier) return TIER_LIMITS.TIER_50;
    return TIER_LIMITS[tier] ?? TIER_LIMITS.TIER_50;
  }

  async getDailyUsage(companyId: string): Promise<number> {
    const cacheKey = this.usageCacheKey(companyId);
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached !== null) {
        return parseInt(cached, 10);
      }
    } catch {
      // fallthrough to DB
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const count = await this.prisma.messagingUsage.count({
      where: { companyId, sentAt: { gte: since } },
    });

    try {
      const ttl = this.getTtlUntilEndOfDay();
      await this.redis.setex(cacheKey, ttl, String(count));
    } catch {
      // ignore cache write errors
    }

    return count;
  }

  async canSend(companyId: string): Promise<DailyLimitStatus> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { messagingLimitTier: true },
    });

    const tier = company?.messagingLimitTier ?? 'TIER_50';
    const limit = this.getDailyLimit(tier);
    const usage = await this.getDailyUsage(companyId);
    const remaining = Math.max(0, limit - usage);
    const resetAt = this.getEndOfDayTimestamp();

    return {
      allowed: remaining > 0,
      remaining,
      limit,
      usage,
      tier,
      resetAt,
    };
  }

  /** `commercial: false` (platform replies) consumes the shared number, never the company quota. */
  async reserveDispatchQuota(
    intentId: string,
    channelId: string,
    options: { commercial: boolean } = { commercial: true },
  ): Promise<void> {
    let channelLimit = TIER_LIMITS.TIER_50;
    try {
      await redisReady(this.redis);
      const cached = await this.redis.get(
        `ciframais:channel-tier:${channelId}`,
      );
      if (cached && this.normalizeTier(cached))
        channelLimit = this.getDailyLimit(this.normalizeTier(cached));
    } catch {
      throw new WhatsappTransportError(
        'Controle do canal indisponivel.',
        'TEMPORARY',
        'NOT_SENT',
        undefined,
        undefined,
        5,
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
        const since = new Date(Date.now() - 86_400_000);
        if (intent.quotaReservedAt && intent.quotaReservedAt > since) return;
        const scopes: Array<{ companyId: string | null; limit: number }> = [
          { companyId: null, limit: channelLimit },
        ];
        if (intent.companyId && options.commercial) {
          const company = await tx.company.findUniqueOrThrow({
            where: { id: intent.companyId },
            select: { messagingLimitTier: true },
          });
          scopes.push({
            companyId: intent.companyId,
            limit: this.getDailyLimit(company.messagingLimitTier),
          });
        }
        for (const scope of scopes) {
          const rows = await tx.$queryRaw<
            Array<{ count: bigint; known: boolean }>
          >(Prisma.sql`
          SELECT count(*) AS count, coalesce(bool_or(recipient = ${intent.recipientHash}), false) AS known FROM (
            SELECT DISTINCT "recipientHash" AS recipient FROM "CommunicationOutboundIntent"
            WHERE "transportChannelId" = ${channelId} AND "quotaReservedAt" > ${since}
              AND (${scope.companyId}::text IS NULL OR "companyId" = ${scope.companyId})
            UNION
            SELECT encode(sha256(convert_to("phoneNumber", 'UTF8')), 'hex') AS recipient FROM "MessagingUsage"
            WHERE "sentAt" > ${since} AND (${scope.companyId}::text IS NULL OR "companyId" = ${scope.companyId})
          ) AS recent`);
          const row = rows[0];
          if (!row || (!row.known && Number(row.count) >= scope.limit))
            throw new WhatsappTransportError(
              'Limite diario do canal ou empresa atingido.',
              'RATE_LIMIT',
              'NOT_SENT',
              undefined,
              undefined,
              3600,
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
        );
      });
  }

  async trackSend(companyId: string, phoneNumber: string): Promise<void> {
    try {
      await this.prisma.messagingUsage.upsert({
        where: {
          companyId_phoneNumber: { companyId, phoneNumber },
        },
        create: { companyId, phoneNumber },
        update: { sentAt: new Date() },
      });

      const cacheKey = this.usageCacheKey(companyId);
      await this.redis.incr(cacheKey);
      const ttl = this.getTtlUntilEndOfDay();
      await this.redis.expire(cacheKey, ttl);
    } catch (error) {
      this.logger.error(
        `Falha ao trackear envio para company ${companyId}:`,
        error,
      );
    }
  }

  /** The central channel tier is informational, not a company's commercial quota. */
  async syncTierFromMeta(
    companyId: string,
  ): Promise<MessagingLimitTier | null> {
    void companyId;
    try {
      const channel = await this.transport.getChannelInfo({
        includeMessagingLimit: true,
      });
      const tier = channel.messagingLimitTier
        ? this.normalizeTier(channel.messagingLimitTier)
        : null;
      if (tier) {
        try {
          await this.redis.setex(
            `ciframais:channel-tier:${channel.phoneNumberId}`,
            86_400,
            tier,
          );
        } catch {
          /* Conservative TIER_50 is used until a verified tier can be cached. */
        }
      }
      return tier;
    } catch {
      this.logger.warn(
        'Nao foi possivel consultar o tier do canal WhatsApp central.',
      );
      return null;
    }
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

  normalizeTier(rawTier: string): MessagingLimitTier | null {
    const upper = rawTier.toUpperCase().replace(/_/g, '_');

    if (upper === 'TIER_50') return 'TIER_50';
    if (upper === 'TIER_250') return 'TIER_250';
    if (upper === 'TIER_1K') return 'TIER_1K';
    if (upper === 'TIER_10K') return 'TIER_10K';
    if (upper === 'TIER_100K') return 'TIER_100K';
    if (upper === 'TIER_UNLIMITED') return 'TIER_UNLIMITED';

    // Mapeia possíveis formatos da Meta
    if (upper === 'BUSINESS_VERIFIED' || upper.includes('UNLIMITED'))
      return 'TIER_UNLIMITED';
    if (upper.includes('100K')) return 'TIER_100K';
    if (upper.includes('10K')) return 'TIER_10K';
    if (upper.includes('1K')) return 'TIER_1K';
    if (upper.includes('250')) return 'TIER_250';

    return null;
  }

  private usageCacheKey(companyId: string): string {
    const today = new Date().toISOString().slice(0, 10);
    return `messaging:daily:${companyId}:${today}`;
  }

  private getEndOfDayTimestamp(): number {
    const now = new Date();
    const end = new Date(now);
    end.setUTCHours(24, 0, 0, 0);
    return end.getTime();
  }

  private getTtlUntilEndOfDay(): number {
    const now = new Date();
    const end = new Date(now);
    end.setUTCHours(24, 0, 0, 0);
    const ttl = Math.ceil((end.getTime() - now.getTime()) / 1000);
    return Math.max(ttl, 60);
  }

  async onModuleDestroy(): Promise<void> {
    await releaseRedis(this.redis);
  }
}
