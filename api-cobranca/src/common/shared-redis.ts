import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';

interface SharedClient {
  client: Redis;
  users: number;
}

const clients = new Map<string, SharedClient>();
const logger = new Logger('SharedRedis');

/**
 * One lazily connected client per Redis target for the whole process, shared by the
 * rate-limit and quota services instead of each opening its own connection.
 * Commands fail fast while disconnected (no offline queue); call `redisReady` first.
 */
export function acquireRedis(config: ConfigService): Redis {
  const host = config.get<string>('REDIS_HOST') || 'localhost';
  const port = Number(config.get('REDIS_PORT') || 6379);
  const password = config.get<string>('REDIS_PASSWORD');
  const key = `${host}:${port}:${password ? createHash('sha256').update(password).digest('hex') : ''}`;
  let shared = clients.get(key);
  if (!shared) {
    const client = new Redis({
      host,
      port,
      password,
      db: 0,
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      commandTimeout: 1500,
    });
    client.on('error', () => logger.warn('SHARED_REDIS_UNAVAILABLE'));
    shared = { client, users: 0 };
    clients.set(key, shared);
  }
  shared.users++;
  return shared.client;
}

/** Closes the shared client when its last user is destroyed. */
export async function releaseRedis(client: Redis): Promise<void> {
  for (const [key, shared] of clients) {
    if (shared.client !== client) continue;
    if (--shared.users > 0) return;
    clients.delete(key);
    if (client.status === 'ready') {
      try {
        await client.quit();
        return;
      } catch {
        /* fall through to a hard disconnect */
      }
    }
    client.disconnect();
    return;
  }
}
