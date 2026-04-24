import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { RateLimitService } from '../services/rate-limit.service';
import { SendMessageJob } from '../message.queue';

@Injectable()
export class MessageWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessageWorkerService.name);
  private worker!: Worker;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private rateLimitService: RateLimitService,
  ) {
    this.baseUrl =
      this.configService.get<string>('EVOLUTION_API_URL') ||
      'http://localhost:8080';
    this.apiKey = this.configService.getOrThrow<string>('EVOLUTION_API_KEY');
  }

  onModuleInit() {
    const redisHost =
      this.configService.get<string>('REDIS_HOST') || 'localhost';
    const redisPort = this.configService.get<number>('REDIS_PORT') || 6379;
    const redisPassword = this.configService.get<string>('REDIS_PASSWORD');

    this.worker = new Worker(
      'whatsapp-messages',
      async (job: Job) => {
        await this.processJob(job);
      },
      {
        connection: {
          host: redisHost,
          port: redisPort,
          password: redisPassword,
        },
        concurrency: 5,
        limiter: {
          max: 10,
          duration: 1000,
        },
      },
    );

    this.worker.on('completed', (job) => {
      this.logger.log(`Job ${job.id} completado com sucesso`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} falhou: ${err.message}`);
    });

    this.worker.on('error', (err) => {
      this.logger.error('Worker error:', err);
    });

    this.logger.log('WhatsApp message worker iniciado');
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
      this.logger.log('WhatsApp message worker parado');
    }
  }

  private async processJob(job: Job): Promise<void> {
    const data = job.data as SendMessageJob;
    const {
      invoiceId,
      companyId,
      phoneNumber,
      instanceName,
      message,
      debtorName,
    } = data;

    this.logger.log(`Processando mensagem para ${debtorName} (${phoneNumber})`);

    const rateLimitResult =
      await this.rateLimitService.checkRateLimit(phoneNumber);

    if (!rateLimitResult.allowed) {
      this.logger.warn(
        `Rate limit atingido para ${phoneNumber}. Agendando retry em ${rateLimitResult.resetAt - Date.now()}ms`,
      );

      const delay = Math.max(rateLimitResult.resetAt - Date.now(), 0);
      throw new Error(`Rate limit: retry after ${delay}ms`);
    }

    try {
      const response = await this.sendMessageViaEvolution(
        instanceName,
        phoneNumber,
        message,
      );

      await this.prisma.collectionLog.create({
        data: {
          companyId,
          invoiceId,
          actionType: 'WHATSAPP_SENT',
          description: `Mensagem de cobrança enviada para ${debtorName} (${phoneNumber}) - ID: ${response.key.id}`,
          status: 'SENT',
        },
      });

      this.logger.log(`Mensagem enviada com sucesso para ${phoneNumber}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Erro desconhecido';

      await this.prisma.collectionLog.create({
        data: {
          companyId,
          invoiceId,
          actionType: 'WHATSAPP_SENT',
          description: `Falha ao enviar para ${debtorName}: ${errorMessage}`,
          status: 'FAILED',
        },
      });

      this.logger.error(
        `Erro ao enviar mensagem para ${phoneNumber}:`,
        errorMessage,
      );
      throw error;
    }
  }

  private async sendMessageViaEvolution(
    instanceName: string,
    phoneNumber: string,
    text: string,
  ): Promise<{
    key: { id: string; remoteJid: string; fromMe: boolean };
    messageTimestamp: string;
    status: string;
  }> {
    const url = `${this.baseUrl}/api/v1/message/sendText/${instanceName}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: this.apiKey,
      },
      body: JSON.stringify({ number: phoneNumber, text }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Evolution API: falha ao enviar mensagem (${res.status}): ${body}`,
      );
    }

    return res.json();
  }
}
