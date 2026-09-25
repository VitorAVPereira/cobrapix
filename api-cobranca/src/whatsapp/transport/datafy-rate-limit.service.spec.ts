import { ConfigService } from '@nestjs/config';
import {
  DatafyRateLimitService,
  DATAFY_INTERVALS,
} from './datafy-rate-limit.service';

describe('Datafy shared quota', () => {
  it('paces 6,000 intents from two companies under one token and recovers after waiting', async () => {
    let now = 0;
    const next = new Map<string, number>();
    const redis = {
      eval: jest.fn(
        (_script: string, _count: number, key: string, interval: number) => {
          const wait = Math.max(0, (next.get(key) ?? 0) - now);
          if (!wait) next.set(key, now + interval);
          return Promise.resolve(wait);
        },
      ),
    };
    const limiter = new DatafyRateLimitService(new ConfigService(), redis);
    const accepted: number[] = [];
    for (let intent = 0; intent < 6000; intent++) {
      await limiter.acquire('synthetic-shared-token', 'SEND');
      accepted.push(now);
      await expect(
        limiter.acquire('synthetic-shared-token', 'SEND'),
      ).rejects.toMatchObject({ kind: 'RATE_LIMIT', outcome: 'NOT_SENT' });
      now += DATAFY_INTERVALS.SEND;
    }
    expect(accepted.filter((time) => time < 60_000)).toHaveLength(500);
    expect(accepted[5999]).toBe(719_880);
    expect(next.size).toBe(1);
    expect([...next.keys()][0]).not.toContain('synthetic-shared-token');
    await limiter.acquire('synthetic-shared-token', 'OTHER');
    await limiter.acquire('synthetic-shared-token', 'UPLOAD');
    await expect(
      limiter.acquire('synthetic-shared-token', 'OTHER'),
    ).rejects.toMatchObject({ retryAfterSeconds: 1 });
    await limiter.acquire('different-token', 'SEND');
  });

  it('does not authorize a request when Redis is unavailable', async () => {
    const redis = {
      eval: jest
        .fn()
        .mockRejectedValue(new Error('private connection details')),
    };
    const limiter = new DatafyRateLimitService(new ConfigService(), redis);
    await expect(limiter.acquire('secret', 'SEND')).rejects.toMatchObject({
      kind: 'TEMPORARY',
      outcome: 'NOT_SENT',
    });
  });
});
