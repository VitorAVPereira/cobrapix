import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MessageQueueService, WhatsAppQueueJob } from './message.queue';

@Controller('queue')
export class QueueController {
  constructor(
    @InjectQueue('whatsapp-messages')
    private readonly whatsappQueue: Queue<WhatsAppQueueJob>,
    private readonly messageQueue: MessageQueueService,
  ) {}

  @Get('stats')
  @UseGuards(JwtAuthGuard)
  async getStats() {
    const stats = await this.messageQueue.getQueueStats();

    const [failedJobs, delayedCount] = await Promise.all([
      this.whatsappQueue.getFailed(0, 50),
      this.whatsappQueue.getDelayedCount(),
    ]);

    const failed = failedJobs.map((job) => ({
      id: job.id,
      name: job.name,
      failedReason: job.failedReason,
      attemptsMade: job.attemptsMade,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    }));

    return {
      ...stats,
      delayed: delayedCount,
      failedRecent: failed,
    };
  }

  @Post('retry/:jobId')
  @UseGuards(JwtAuthGuard)
  async retryJob(@Param('jobId') jobId: string) {
    const job = await Job.fromId(this.whatsappQueue, jobId);
    if (!job) {
      throw new HttpException('Job nao encontrado', HttpStatus.NOT_FOUND);
    }

    const state = await job.getState();
    if (state !== 'failed') {
      throw new HttpException(
        `Job nao esta falhado (estado: ${state})`,
        HttpStatus.BAD_REQUEST,
      );
    }

    await job.retry();
    return { success: true, jobId };
  }
}
