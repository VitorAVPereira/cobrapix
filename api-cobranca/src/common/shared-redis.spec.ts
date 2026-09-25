import { ConfigService } from '@nestjs/config';
import { acquireRedis, releaseRedis } from './shared-redis';

const mockDisconnects: jest.Mock[] = [];
jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => {
    const disconnect = jest.fn();
    mockDisconnects.push(disconnect);
    return { status: 'wait', on: jest.fn(), quit: jest.fn(), disconnect };
  }),
}));

describe('shared Redis client', () => {
  it('opens one client per target and closes it with its last user', async () => {
    const config = new ConfigService({ REDIS_HOST: 'redis', REDIS_PORT: 6379 });
    const first = acquireRedis(config);
    const second = acquireRedis(config);
    const other = acquireRedis(
      new ConfigService({ REDIS_HOST: 'redis', REDIS_PORT: 6380 }),
    );
    expect(second).toBe(first);
    expect(other).not.toBe(first);
    expect(mockDisconnects).toHaveLength(2);
    await releaseRedis(first);
    expect(mockDisconnects[0]).not.toHaveBeenCalled();
    await releaseRedis(second);
    expect(mockDisconnects[0]).toHaveBeenCalledTimes(1);
    expect(acquireRedis(config)).not.toBe(first);
  });
});
