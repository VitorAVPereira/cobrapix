import type Redis from 'ioredis';

const attempts = new WeakMap<Redis, Promise<void>>();

/**
 * Lazily connects a client once. Concurrent first calls share the same attempt;
 * calling `connect()` twice would reject the second caller as unavailable.
 */
export function redisReady(redis: Redis): Promise<void> {
  if (!['wait', 'connecting', 'connect', 'reconnecting'].includes(redis.status))
    return Promise.resolve();
  let attempt = attempts.get(redis);
  if (!attempt) {
    attempt = (
      redis.status === 'wait'
        ? redis.connect()
        : new Promise<void>((resolve, reject) => {
            const ready = (): void => {
              redis.off('error', failed);
              resolve();
            };
            const failed = (error: Error): void => {
              redis.off('ready', ready);
              reject(error);
            };
            redis.once('ready', ready);
            redis.once('error', failed);
          })
    ).finally(() => attempts.delete(redis));
    attempts.set(redis, attempt);
  }
  return attempt;
}
