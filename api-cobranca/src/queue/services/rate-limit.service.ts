import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface RateLimitConfig {
  maxMessages: number;
  windowMs: number;
}

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private redis: Redis;
  private readonly defaultConfig: RateLimitConfig = {
    maxMessages: 20,
    windowMs: 60 * 60 * 1000,
  };

  constructor(private configService: ConfigService) {
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
      this.logger.error('Redis connection error:', err);
    });

    this.redis.on('connect', () => {
      this.logger.log('Connected to Redis for rate limiting');
    });
  }

  async checkRateLimit(
    phoneNumber: string,
    config?: Partial<RateLimitConfig>,
  ): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: number;
  }> {
    const rateConfig = { ...this.defaultConfig, ...config };
    const key = `ratelimit:${phoneNumber}`;
    const windowSeconds = Math.floor(rateConfig.windowMs / 1000);

    try {
      const current = await this.redis.get(key);

      if (!current) {
        await this.redis.setex(key, windowSeconds, '1');
        return {
          allowed: true,
          remaining: rateConfig.maxMessages - 1,
          resetAt: Date.now() + rateConfig.windowMs,
        };
      }

      const count = parseInt(current, 10);

      if (count >= rateConfig.maxMessages) {
        const ttl = await this.redis.ttl(key);
        return {
          allowed: false,
          remaining: 0,
          resetAt: Date.now() + ttl * 1000,
        };
      }

      await this.redis.incr(key);

      return {
        allowed: true,
        remaining: rateConfig.maxMessages - count - 1,
        resetAt: Date.now() + (await this.redis.ttl(key)) * 1000,
      };
    } catch (error) {
      this.logger.error('Error checking rate limit:', error);
      return {
        allowed: true,
        remaining: rateConfig.maxMessages,
        resetAt: Date.now() + rateConfig.windowMs,
      };
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

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
