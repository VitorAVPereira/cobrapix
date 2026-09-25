import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import {
  DATAFY_WEBHOOK_QUEUE,
  DatafyWebhookJob,
  datafyRedisConnection,
} from '../datafy-webhook.queue';
import { DatafyWebhookService } from '../../webhooks/datafy-webhook.service';

@Injectable()
export class DatafyWebhookWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatafyWebhookWorker.name);
  private worker?: Worker<DatafyWebhookJob>;
  constructor(
    private readonly config: ConfigService,
    private readonly service: DatafyWebhookService,
  ) {}
  onModuleInit(): void {
    this.worker = new Worker<DatafyWebhookJob>(
      DATAFY_WEBHOOK_QUEUE,
      async (job: Job<DatafyWebhookJob>): Promise<void> => {
        try {
          await this.service.processDelivery(job.data.deliveryId);
        } catch {
          throw new Error('DATAFY_PROCESSING_RETRY');
        }
      },
      {
        connection: datafyRedisConnection(this.config, true),
        concurrency: 4,
        lockDuration: 30_000,
      },
    );
    this.worker.on('error', () =>
      this.logger.warn('DATAFY_WORKER_UNAVAILABLE'),
    );
    this.worker.on('failed', () =>
      this.logger.warn('DATAFY_JOB_RETRY_OR_REVIEW'),
    );
  }
  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
