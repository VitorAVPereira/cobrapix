import { EventEmitter } from 'node:events';
import type Redis from 'ioredis';
import { redisReady } from './redis-ready';

function fakeRedis(status: string) {
  const client = Object.assign(new EventEmitter(), {
    status,
    connect: jest.fn(() => {
      client.status = 'connecting';
      return new Promise<void>((resolve) =>
        setTimeout(() => {
          client.status = 'ready';
          client.emit('ready');
          resolve();
        }, 10),
      );
    }),
  });
  return client;
}

describe('redisReady', () => {
  it('shares one lazy connection attempt between concurrent first callers', async () => {
    const client = fakeRedis('wait');
    await Promise.all([
      redisReady(client as unknown as Redis),
      redisReady(client as unknown as Redis),
      redisReady(client as unknown as Redis),
    ]);
    expect(client.connect).toHaveBeenCalledTimes(1);
    await redisReady(client as unknown as Redis);
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it('waits for a reconnection started elsewhere and surfaces its failure', async () => {
    const client = fakeRedis('reconnecting');
    const waiting = redisReady(client as unknown as Redis);
    client.emit('error', new Error('offline'));
    await expect(waiting).rejects.toThrow('offline');
    expect(client.connect).not.toHaveBeenCalled();
  });
});
