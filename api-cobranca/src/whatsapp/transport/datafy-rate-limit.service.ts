import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import { redisReady } from '../../common/redis-ready';
import { acquireRedis, releaseRedis } from '../../common/shared-redis';
import { WhatsappTransportError } from './whatsapp-transport.error';

export const DATAFY_INTERVALS = {
  SEND: 120,
  UPLOAD: 1000,
  OTHER: 1000,
} as const;
export type DatafyRequestCategory = keyof typeof DATAFY_INTERVALS;
export const DATAFY_LIMIT_REDIS = Symbol('DATAFY_LIMIT_REDIS');
interface QuotaRedis {
  eval(
    script: string,
    count: number,
    key: string,
    interval: number,
  ): Promise<unknown>;
}

// Redis TIME makes all API processes share the same clock. No burst credit accumulates.
export const DATAFY_QUOTA_SCRIPT = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local next = tonumber(redis.call('GET', KEYS[1]) or '0')
if next > now then return next - now end
redis.call('SET', KEYS[1], now + tonumber(ARGV[1]), 'PX', tonumber(ARGV[1]) * 2)
return 0`;

@Injectable()
export class DatafyRateLimitService implements OnModuleDestroy {
  private readonly redis: QuotaRedis;
  private readonly ownedRedis?: Redis;
  constructor(
    config: ConfigService,
    @Optional() @Inject(DATAFY_LIMIT_REDIS) redis?: QuotaRedis,
  ) {
    if (redis) this.redis = redis;
    else {
      this.ownedRedis = acquireRedis(config);
      this.redis = this.ownedRedis;
    }
  }

  async acquire(token: string, category: DatafyRequestCategory): Promise<void> {
    let wait: unknown;
    try {
      if (this.ownedRedis) await redisReady(this.ownedRedis);
      const identity = createHash('sha256').update(token).digest('hex');
      wait = await this.redis.eval(
        DATAFY_QUOTA_SCRIPT,
        1,
        `ciframais:datafy:quota:${identity}:${category}`,
        DATAFY_INTERVALS[category],
      );
      if (typeof wait !== 'number' || !Number.isFinite(wait) || wait < 0)
        throw new Error('INVALID_QUOTA');
    } catch {
      throw new WhatsappTransportError(
        'Controle de envios indisponivel. Envio permanece pendente.',
        'TEMPORARY',
        'NOT_SENT',
        undefined,
        undefined,
        5,
      );
    }
    if (wait > 0)
      throw new WhatsappTransportError(
        'Aguarde a quota compartilhada do canal.',
        'RATE_LIMIT',
        'NOT_SENT',
        undefined,
        undefined,
        Math.ceil(wait / 1000),
      );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.ownedRedis) await releaseRedis(this.ownedRedis);
  }
}
