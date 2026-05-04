import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MessagingLimitTier } from '@prisma/client';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentCryptoService } from '../../payment/payment-crypto.service';

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

interface CompanyMetaConfig {
  metaPhoneNumberId: string | null;
  metaAccessTokenEncrypted: string | null;
  messagingLimitTier: MessagingLimitTier | null;
}

@Injectable()
export class MessagingLimitService {
  private readonly logger = new Logger(MessagingLimitService.name);
  private redis: Redis;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private crypto: PaymentCryptoService,
  ) {
    const redisHost =
      this.configService.get<string>('REDIS_HOST') || 'localhost';
    const redisPort = this.configService.get<number>('REDIS_PORT') || 6379;
    const redisPassword = this.configService.get<string>('REDIS_PASSWORD');

    this.redis = new Redis({
      host: redisHost,
      port: redisPort,
      password: redisPassword,
      lazyConnect: true,
    });

    this.redis.on('error', (err) => {
      this.logger.error('Redis (messaging-limit) connection error:', err);
    });
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

  async syncTierFromMeta(
    companyId: string,
  ): Promise<MessagingLimitTier | null> {
    const company = await this.getCompanyMetaConfig(companyId);
    if (!company?.metaPhoneNumberId || !company.metaAccessTokenEncrypted) {
      return null;
    }

    try {
      const token = this.crypto.decrypt(company.metaAccessTokenEncrypted);
      const version =
        this.configService.get<string>('META_GRAPH_API_VERSION') || 'v23.0';
      const url = `https://graph.facebook.com/${version}/${company.metaPhoneNumberId}?fields=messaging_limit_tier`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        this.logger.warn(
          `Meta API retornou ${response.status} ao consultar tier de ${companyId}`,
        );
        return null;
      }

      const data = (await response.json()) as {
        messaging_limit_tier?: string;
      };

      if (!data.messaging_limit_tier) return null;

      const tier = this.normalizeTier(data.messaging_limit_tier);
      if (!tier) return null;

      await this.prisma.company.update({
        where: { id: companyId },
        data: {
          messagingLimitTier: tier,
          messagingLimitUpdatedAt: new Date(),
        },
      });

      this.logger.log(
        `Tier da empresa ${companyId} sincronizado da Meta: ${tier}`,
      );

      return tier;
    } catch (error) {
      this.logger.error(
        `Falha ao sincronizar tier da Meta para company ${companyId}:`,
        error,
      );
      return null;
    }
  }

  async updateTierFromWebhook(
    companyId: string,
    tier: MessagingLimitTier,
  ): Promise<void> {
    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        messagingLimitTier: tier,
        messagingLimitUpdatedAt: new Date(),
      },
    });

    this.logger.log(
      `Tier da empresa ${companyId} atualizado via webhook: ${tier}`,
    );
  }

  async getInteractionStats(companyId: string): Promise<{
    outbound: number;
    delivered: number;
    read: number;
    inbound: number;
    failed: number;
  }> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [outbound, delivered, read, inbound, failed] = await Promise.all([
      this.prisma.whatsAppInteraction.count({
        where: { companyId, direction: 'OUTBOUND', receivedAt: { gte: since } },
      }),
      this.prisma.whatsAppInteraction.count({
        where: {
          companyId,
          direction: 'OUTBOUND',
          status: 'delivered',
          receivedAt: { gte: since },
        },
      }),
      this.prisma.whatsAppInteraction.count({
        where: {
          companyId,
          direction: 'OUTBOUND',
          status: 'read',
          receivedAt: { gte: since },
        },
      }),
      this.prisma.whatsAppInteraction.count({
        where: { companyId, direction: 'INBOUND', receivedAt: { gte: since } },
      }),
      this.prisma.whatsAppInteraction.count({
        where: {
          companyId,
          direction: 'OUTBOUND',
          status: 'failed',
          receivedAt: { gte: since },
        },
      }),
    ]);

    return { outbound, delivered, read, inbound, failed };
  }

  async recordInteraction(params: {
    companyId: string;
    phoneNumber: string;
    direction: 'INBOUND' | 'OUTBOUND';
    status?: string;
    messageId?: string;
    rawPayload?: unknown;
  }): Promise<void> {
    await this.prisma.whatsAppInteraction.create({
      data: {
        companyId: params.companyId,
        phoneNumber: params.phoneNumber,
        direction: params.direction,
        status: params.status,
        messageId: params.messageId,
        rawPayload: params.rawPayload
          ? (params.rawPayload as object)
          : undefined,
      },
    });
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

  private async getCompanyMetaConfig(
    companyId: string,
  ): Promise<CompanyMetaConfig | null> {
    return this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        metaPhoneNumberId: true,
        metaAccessTokenEncrypted: true,
        messagingLimitTier: true,
      },
    });
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

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
