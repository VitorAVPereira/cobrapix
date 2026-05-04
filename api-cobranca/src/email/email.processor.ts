import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, Job } from 'bullmq';
import { EmailService } from './email.service';

export interface SendEmailJob {
  companyId: string;
  invoiceId: string;
  debtorId: string;
  debtorName: string;
  email: string;
  subject: string;
  html: string;
  ruleStepId?: string;
}

@Injectable()
export class EmailProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailProcessor.name);
  private worker!: Worker;

  constructor(
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  onModuleInit() {
    const redisHost =
      this.configService.get<string>('REDIS_HOST') || 'localhost';
    const redisPort = this.configService.get<number>('REDIS_PORT') || 6379;
    const redisPassword = this.configService.get<string>('REDIS_PASSWORD');

    this.worker = new Worker(
      'email-messages',
      async (job: Job<SendEmailJob>) => {
        await this.processJob(job);
      },
      {
        connection: {
          host: redisHost,
          port: redisPort,
          password: redisPassword,
        },
        concurrency: 10,
        limiter: { max: 10, duration: 1_000 },
        removeOnComplete: { count: 5000, age: 48 * 3600 },
        removeOnFail: { count: 10000, age: 14 * 24 * 3600 },
      },
    );

    this.worker.on('completed', (job) => {
      this.logger.log(`Email job ${job.id} completado`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Email job ${job?.id ?? 'desconhecido'} falhou: ${err.message}`,
      );
    });

    this.logger.log('Email worker iniciado');
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
      this.logger.log('Email worker parado');
    }
  }

  private async processJob(job: Job<SendEmailJob>): Promise<void> {
    const data = job.data;

    try {
      await this.emailService.send(data);
    } catch (error) {
      await this.emailService.markAttemptAsFailed(
        data,
        error instanceof Error ? error.message : 'Erro desconhecido',
      );
      throw error;
    }
  }
}
