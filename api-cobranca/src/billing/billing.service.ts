import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private isRunning = false;

  constructor(
    private prisma: PrismaService,
    private whatsappService: WhatsappService,
  ) {}

  /**
   * Executa cobranças automaticamente às 9h e 17h
   * Usa lock no Postgres para evitar execuções duplicadas em múltiplas instâncias
   */
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
      // Lock no Postgres usando advisory lock
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

        let totalSent = 0;
        let totalFailed = 0;
        let totalSkipped = 0;

        for (const company of companies) {
          const result = await this.executeBillingForCompany(company.id);
          totalSent += result.sent;
          totalFailed += result.failed;
          totalSkipped += result.skipped;
        }

        this.logger.log(
          `Resumo geral: ${totalSent} enviadas, ${totalFailed} simuladas, ${totalSkipped} puladas`,
        );
      } finally {
        // Libera o lock
        await this.prisma.$queryRaw`SELECT pg_advisory_unlock(1)`;
      }
    } catch (error) {
      this.logger.error('Erro ao executar cobranças automáticas:', error);
    } finally {
      this.isRunning = false;
    }
  }

  async executeBilling(companyId: string): Promise<{
    sent: number;
    failed: number;
    skipped: number;
  }> {
    return this.executeBillingForCompany(companyId);
  }

  private async executeBillingForCompany(companyId: string): Promise<{
    sent: number;
    failed: number;
    skipped: number;
  }> {
    try {
      const company = await this.prisma.company.findUnique({
        where: { id: companyId },
      });

      if (!company || company.whatsappStatus !== 'CONNECTED' || !company.whatsappInstanceId) {
        this.logger.log(`Empresa ${companyId} não está pronta para cobranças`);
        return { sent: 0, failed: 0, skipped: 0 };
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

      let sentCount = 0;
      let failedCount = 0;
      let skippedCount = 0;

      for (const invoice of overdueInvoices) {
        // Dedup: já cobrada hoje
        if (invoice.collectionLogs.length > 0) {
          skippedCount++;
          continue;
        }

        const message = this.buildCollectionMessage({
          debtorName: invoice.debtor.name,
          originalAmount: Number(invoice.originalAmount),
          dueDate: invoice.dueDate,
          companyName: company.corporateName,
        });

        let phone = invoice.debtor.phoneNumber;
        if (!phone.startsWith('55')) {
          phone = `55${phone}`;
        }

        try {
          await this.whatsappService.sendTextMessage(
            company.whatsappInstanceId,
            phone,
            message,
          );

          await this.prisma.collectionLog.create({
            data: {
              companyId: company.id,
              invoiceId: invoice.id,
              actionType: 'WHATSAPP_SENT',
              description: `Mensagem de cobrança enviada para ${invoice.debtor.name} (${phone})`,
              status: 'SENT',
            },
          });

          sentCount++;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';

          await this.prisma.collectionLog.create({
            data: {
              companyId: company.id,
              invoiceId: invoice.id,
              actionType: 'WHATSAPP_SENT',
              description: `SIMULADO - Falha ao enviar para ${invoice.debtor.name}: ${errorMessage}`,
              status: 'SIMULATED',
            },
          });

          failedCount++;
        }
      }

      this.logger.log(
        `Empresa ${company.corporateName}: ${sentCount} enviadas, ${failedCount} simuladas, ${skippedCount} puladas`,
      );

      return { sent: sentCount, failed: failedCount, skipped: skippedCount };
    } catch (error) {
      this.logger.error(`Erro ao executar cobranças para empresa ${companyId}:`, error);
      return { sent: 0, failed: 0, skipped: 0 };
    }
  }

  private buildCollectionMessage(params: {
    debtorName: string;
    originalAmount: number;
    dueDate: Date;
    companyName: string;
  }): string {
    const { debtorName, originalAmount, dueDate, companyName } = params;

    const valorFormatado = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(originalAmount);

    const dataFormatada = new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'America/Sao_Paulo',
    }).format(dueDate);

    return [
      `Prezado(a) ${debtorName},`,
      ``,
      `Informamos que consta em nosso sistema uma fatura em seu nome no valor de ${valorFormatado}, com vencimento em ${dataFormatada}.`,
      ``,
      `Solicitamos a gentileza de regularizar o pagamento o mais breve possível.`,
      ``,
      `Em caso de dúvidas, entre em contato conosco.`,
      ``,
      `Atenciosamente,`,
      `${companyName}`,
    ].join('\n');
  }
}
