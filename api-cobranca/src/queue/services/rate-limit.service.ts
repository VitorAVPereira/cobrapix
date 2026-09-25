import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { acquireRedis, releaseRedis } from '../../common/shared-redis';
import { redisReady } from '../../common/redis-ready';
export const RATE_LIMIT_SCRIPT = `
local ttl = redis.call('TTL', KEYS[1])
if ARGV[3] == '1' and redis.call('EXISTS', KEYS[2]) == 1 then return {1, 0, math.max(ttl, 0)} end
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current >= tonumber(ARGV[1]) then return {0, 0, math.max(ttl, 1)} end
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
ttl = redis.call('TTL', KEYS[1])
if ARGV[3] == '1' then redis.call('SET', KEYS[2], '1', 'EX', math.max(ttl, 1)) end
return {1, tonumber(ARGV[1]) - count, ttl}
`;

export interface RateLimitConfig {
  maxMessages: number;
  windowMs: number;
}

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly redis: Redis;
  private readonly defaultConfig: RateLimitConfig = {
    maxMessages: 20,
    windowMs: 60 * 60 * 1000,
  };

  constructor(configService: ConfigService) {
    this.redis = acquireRedis(configService);
  }

  async checkRateLimit(
    phoneNumber: string,
    config?: Partial<RateLimitConfig>,
    reservationId?: string,
  ): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: number;
  }> {
    const rateConfig = { ...this.defaultConfig, ...config };
    const key = `ratelimit:${phoneNumber}`;
    const windowSeconds = Math.floor(rateConfig.windowMs / 1000);

    try {
      await redisReady(this.redis);
      const marker = reservationId
        ? key + ':intent:' + reservationId
        : key + ':unused';
      const result = (await this.redis.eval(
        RATE_LIMIT_SCRIPT,
        2,
        key,
        marker,
        rateConfig.maxMessages,
        windowSeconds,
        reservationId ? '1' : '0',
      )) as [number, number, number];
      return {
        allowed: result[0] === 1,
        remaining: result[1],
        resetAt: Date.now() + result[2] * 1000,
      };
    } catch {
      this.logger.warn('RATE_LIMIT_UNAVAILABLE');
      return { allowed: false, remaining: 0, resetAt: Date.now() + 5000 };
    }
  }

  async getTimeUntilNextMessage(phoneNumber: string): Promise<number> {
    const key = `ratelimit:${phoneNumber}`;
    try {
      const ttl = await this.redis.ttl(key);
      return ttl > 0 ? ttl * 1000 : 0;
    } catch {
      return 0;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await releaseRedis(this.redis);
  }
}
