import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, ConnectionOptions } from 'bullmq';

export const DATAFY_WEBHOOK_QUEUE = 'datafy-webhooks';
export interface DatafyWebhookJob {
  deliveryId: string;
}

export function datafyRedisConnection(
  config: ConfigService,
  worker = false,
): ConnectionOptions {
  return {
    host: config.get<string>('REDIS_HOST') ?? 'localhost',
    port: config.get<number>('REDIS_PORT') ?? 6379,
    password: config.get<string>('REDIS_PASSWORD'),
    db: 0,
    connectTimeout: 1000,
    maxRetriesPerRequest: worker ? null : 1,
    enableOfflineQueue: worker,
  };
}

@Injectable()
export class DatafyWebhookQueue implements OnModuleInit {
  private readonly logger = new Logger(DatafyWebhookQueue.name);
  constructor(
    @InjectQueue(DATAFY_WEBHOOK_QUEUE)
    private readonly queue: Queue<DatafyWebhookJob>,
  ) {}
  onModuleInit(): void {
    this.queue.on('error', () => this.logger.warn('DATAFY_QUEUE_UNAVAILABLE'));
  }
  async enqueue(
    deliveryId: string,
    attempt: number,
    generation = 0,
  ): Promise<void> {
    await this.queue.add(
      'process-delivery',
      { deliveryId },
      {
        jobId: `${deliveryId}-${generation}-${attempt}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: { age: 86400, count: 1000 },
      },
    );
  }
}
