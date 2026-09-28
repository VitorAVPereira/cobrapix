import {
  ConflictException,
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
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { PrismaService } from '../prisma/prisma.service';
import {
  MessageQueueService,
  SendMessageJob,
  WhatsAppQueueJob,
} from './message.queue';

/** Logical key of a collection send, shared by producers, holds and retries. */
export function collectionLogicalKey(input: {
  companyId: string;
  invoiceId: string;
  ruleStepId?: string | null;
}): string {
  return `collection:${input.companyId}:${input.invoiceId}:${input.ruleStepId ?? 'initial'}:WHATSAPP`;
}

/** Global queue controls are platform-admin only; a retry never skips a template review. */
@Controller('queue')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class QueueController {
  constructor(
    @InjectQueue('whatsapp-messages')
    private readonly whatsappQueue: Queue<WhatsAppQueueJob>,
    private readonly messageQueue: MessageQueueService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('stats')
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
  async retryJob(@Param('jobId') jobId: string) {
    const job: Job<WhatsAppQueueJob> | undefined = await Job.fromId(
      this.whatsappQueue,
      jobId,
    );
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

    await this.assertRetryable(job);
    await job.retry();
    return { success: true, jobId };
  }

  /** The persisted state decides: held, accepted, uncertain or in-flight work is not retried. */
  private async assertRetryable(job: Job<WhatsAppQueueJob>): Promise<void> {
    const refuse = (code: string) =>
      new ConflictException({
        code,
        message:
          'Envio retido ou ja processado. Revise a pendencia no painel de templates.',
      });
    if (job.name === 'outbound-intent' && 'intentId' in job.data) {
      const intent = await this.prisma.communicationOutboundIntent.findUnique({
        where: { id: job.data.intentId },
        select: { state: true },
      });
      if (intent?.state !== 'PENDING')
        throw refuse(
          intent?.state === 'BLOCKED'
            ? 'OUTBOUND_BLOCKED'
            : 'OUTBOUND_NOT_RETRYABLE',
        );
      return;
    }
    if (job.name === 'send-message') {
      const data = job.data as SendMessageJob;
      const hold = await this.prisma.whatsappTemplatePendingSend.findUnique({
        where: { logicalKey: collectionLogicalKey(data) },
        select: { state: true },
      });
      if (hold && hold.state !== 'CLOSED') throw refuse('OUTBOUND_BLOCKED');
    }
  }
}
