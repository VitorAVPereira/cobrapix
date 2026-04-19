import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MessageQueueService, SendMessageJob } from '../queue/message.queue';
import { SpintaxService } from '../queue/services/spintax.service';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private isRunning = false;

  constructor(
    private prisma: PrismaService,
    private messageQueue: MessageQueueService,
    private spintaxService: SpintaxService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  @Cron(CronExpression.EVERY_DAY_AT_5PM)
  async runScheduledBilling(): Promise<void> {
    if (this.isRunning) {
      this.logger.log('Cobrança automática já está em execução. Pulando...');
      return;
    }

    this.isRunning = true;
    this.logger.log('Iniciando execução de cobranças automáticas...');

    try {
      const lockResult = await this.prisma.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_lock(1) as locked
      `;

      if (!lockResult[0]?.locked) {
        this.logger.log('Outra instância está executando cobranças. Pulando...');
        return;
      }

      try {
        const companies = await this.prisma.company.findMany({
          where: {
            whatsappStatus: 'CONNECTED',
            whatsappInstanceId: { not: null },
          },
        });

        this.logger.log(`Encontradas ${companies.length} empresas com WhatsApp conectado`);

        let totalQueued = 0;
        let totalSkipped = 0;

        for (const company of companies) {
          const result = await this.queueBillingForCompany(company.id);
          totalQueued += result.queued;
          totalSkipped += result.skipped;
        }

        this.logger.log(
          `Resumo geral: ${totalQueued} mensagens enfileiradas, ${totalSkipped} puladas`,
        );
      } finally {
        await this.prisma.$queryRaw`SELECT pg_advisory_unlock(1)`;
      }
    } catch (error) {
      this.logger.error('Erro ao executar cobranças automáticas:', error);
    } finally {
      this.isRunning = false;
    }
  }

  async executeBilling(companyId: string): Promise<{
    queued: number;
    skipped: number;
  }> {
    return this.queueBillingForCompany(companyId);
  }

  private async queueBillingForCompany(companyId: string): Promise<{
    queued: number;
    skipped: number;
  }> {
    try {
      const company = await this.prisma.company.findUnique({
        where: { id: companyId },
      });

      if (!company || company.whatsappStatus !== 'CONNECTED' || !company.whatsappInstanceId) {
        this.logger.log(`Empresa ${companyId} não está pronta para cobranças`);
        return { queued: 0, skipped: 0 };
      }

      const endOfToday = new Date();
      endOfToday.setHours(23, 59, 59, 999);

      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const overdueInvoices = await this.prisma.invoice.findMany({
        where: {
          companyId: company.id,
          status: 'PENDING',
          dueDate: { lte: endOfToday },
        },
        include: {
          debtor: true,
          collectionLogs: {
            where: {
              createdAt: { gte: startOfToday },
              actionType: 'WHATSAPP_SENT',
            },
          },
        },
      });

      const jobs: SendMessageJob[] = [];
      let skippedCount = 0;

      for (const invoice of overdueInvoices) {
        if (invoice.collectionLogs.length > 0) {
          skippedCount++;
          continue;
        }

        let phone = invoice.debtor.phoneNumber;
        if (!phone.startsWith('55')) {
          phone = `55${phone}`;
        }

        const message = this.spintaxService.buildCollectionMessage({
          debtorName: invoice.debtor.name,
          originalAmount: Number(invoice.originalAmount),
          dueDate: invoice.dueDate,
          companyName: company.corporateName,
        });

        jobs.push({
          invoiceId: invoice.id,
          companyId: company.id,
          phoneNumber: phone,
          instanceName: company.whatsappInstanceId,
          message,
          debtorName: invoice.debtor.name,
        });
      }

      if (jobs.length > 0) {
        await this.messageQueue.addBulkSendMessageJobs(jobs);
        this.logger.log(
          `Empresa ${company.corporateName}: ${jobs.length} mensagens enfileiradas, ${skippedCount} puladas`,
        );
      } else {
        this.logger.log(
          `Empresa ${company.corporateName}: nenhuma mensagem para enviar, ${skippedCount} puladas`,
        );
      }

      return { queued: jobs.length, skipped: skippedCount };
    } catch (error) {
      this.logger.error(`Erro ao executar cobranças para empresa ${companyId}:`, error);
      return { queued: 0, skipped: 0 };
    }
  }
}