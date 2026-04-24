import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MessageQueueService, SendMessageJob } from '../queue/message.queue';
import { SpintaxService } from '../queue/services/spintax.service';

const DEFAULT_COLLECTION_REMINDER_DAYS = [0];
const DAY_IN_MS = 24 * 60 * 60 * 1000;

interface BillingExecutionResult {
  queued: number;
  skipped: number;
}

export interface BillingSettingsResponse {
  collectionReminderDays: number[];
}

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
      this.logger.log('Cobranca automatica ja esta em execucao. Pulando...');
      return;
    }

    this.isRunning = true;
    this.logger.log('Iniciando execucao de cobrancas automaticas...');

    try {
      const lockResult = await this.prisma.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_lock(1) as locked
      `;

      if (!lockResult[0]?.locked) {
        this.logger.log(
          'Outra instancia esta executando cobrancas. Pulando...',
        );
        return;
      }

      try {
        const companies = await this.prisma.company.findMany({
          where: {
            whatsappStatus: 'CONNECTED',
            whatsappInstanceId: { not: null },
          },
        });

        this.logger.log(
          `Encontradas ${companies.length} empresas com WhatsApp conectado`,
        );

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
      this.logger.error('Erro ao executar cobrancas automaticas:', error);
    } finally {
      this.isRunning = false;
    }
  }

  async executeBilling(companyId: string): Promise<BillingExecutionResult> {
    return this.queueBillingForCompany(companyId);
  }

  async getSettings(companyId: string): Promise<BillingSettingsResponse> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { collectionReminderDays: true },
    });

    return {
      collectionReminderDays: this.normalizeReminderDays(
        company?.collectionReminderDays,
      ),
    };
  }

  async updateSettings(
    companyId: string,
    reminderDays: number[],
  ): Promise<BillingSettingsResponse> {
    const collectionReminderDays = this.normalizeReminderDays(reminderDays);

    const company = await this.prisma.company.update({
      where: { id: companyId },
      data: { collectionReminderDays },
      select: { collectionReminderDays: true },
    });

    return {
      collectionReminderDays: this.normalizeReminderDays(
        company.collectionReminderDays,
      ),
    };
  }

  private async queueBillingForCompany(
    companyId: string,
  ): Promise<BillingExecutionResult> {
    try {
      const company = await this.prisma.company.findUnique({
        where: { id: companyId },
      });

      if (
        !company ||
        company.whatsappStatus !== 'CONNECTED' ||
        !company.whatsappInstanceId
      ) {
        this.logger.log(`Empresa ${companyId} nao esta pronta para cobrancas`);
        return { queued: 0, skipped: 0 };
      }

      const scheduledOffsets = this.normalizeReminderDays(
        company.collectionReminderDays,
      );
      const templateSlugs = this.getTemplateSlugsForOffsets(scheduledOffsets);
      const templates = await this.prisma.messageTemplate.findMany({
        where: {
          companyId,
          slug: { in: templateSlugs },
          isActive: true,
        },
      });
      const templatesBySlug = new Map(
        templates.map((template) => [template.slug, template]),
      );
      const fallbackTemplate =
        templatesBySlug.get('vencimento-hoje') ?? templates[0];

      if (!fallbackTemplate) {
        this.logger.warn(
          `Nenhum template de cobranca ativo para empresa ${companyId}`,
        );
        return { queued: 0, skipped: 0 };
      }

      const startOfToday = this.startOfDay(new Date());
      const dueDateWindows = scheduledOffsets.map((offset) =>
        this.getDueDateWindow(startOfToday, offset),
      );

      const scheduledInvoices = await this.prisma.invoice.findMany({
        where: {
          companyId: company.id,
          status: 'PENDING',
          OR: dueDateWindows,
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

      for (const invoice of scheduledInvoices) {
        const daysFromDueDate = this.getDaysBetween(
          startOfToday,
          this.startOfDay(invoice.dueDate),
        );

        if (!scheduledOffsets.includes(daysFromDueDate)) {
          skippedCount++;
          continue;
        }

        if (invoice.collectionLogs.length > 0) {
          skippedCount++;
          continue;
        }

        let phone = invoice.debtor.phoneNumber;
        if (!phone.startsWith('55')) {
          phone = `55${phone}`;
        }

        const templateSlug = this.getTemplateSlugForOffset(daysFromDueDate);
        const template = templatesBySlug.get(templateSlug) ?? fallbackTemplate;
        const message = this.buildMessageFromTemplate(template.content, {
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
      this.logger.error(
        `Erro ao executar cobrancas para empresa ${companyId}:`,
        error,
      );
      return { queued: 0, skipped: 0 };
    }
  }

  private normalizeReminderDays(
    reminderDays: number[] | null | undefined,
  ): number[] {
    const normalizedDays = Array.from(
      new Set(
        (reminderDays ?? DEFAULT_COLLECTION_REMINDER_DAYS).filter(
          (day) => Number.isInteger(day) && day >= -30 && day <= 365,
        ),
      ),
    ).sort((left, right) => left - right);

    return normalizedDays.length > 0
      ? normalizedDays
      : DEFAULT_COLLECTION_REMINDER_DAYS;
  }

  private getTemplateSlugsForOffsets(offsets: number[]): string[] {
    return Array.from(
      new Set([
        'vencimento-hoje',
        ...offsets.map((offset) => this.getTemplateSlugForOffset(offset)),
      ]),
    );
  }

  private getTemplateSlugForOffset(offset: number): string {
    if (offset < 0) {
      return 'pre-vencimento';
    }

    if (offset === 0) {
      return 'vencimento-hoje';
    }

    if (offset <= 2) {
      return 'atraso-primeiro-aviso';
    }

    return 'atraso-recorrente';
  }

  private getDueDateWindow(
    startOfToday: Date,
    offset: number,
  ): {
    dueDate: {
      gte: Date;
      lte: Date;
    };
  } {
    const targetDate = this.startOfDay(this.addDays(startOfToday, -offset));

    return {
      dueDate: {
        gte: targetDate,
        lte: this.endOfDay(targetDate),
      },
    };
  }

  private startOfDay(date: Date): Date {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  private endOfDay(date: Date): Date {
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    return end;
  }

  private addDays(date: Date, days: number): Date {
    const target = new Date(date);
    target.setDate(target.getDate() + days);
    return target;
  }

  private getDaysBetween(left: Date, right: Date): number {
    return Math.round((left.getTime() - right.getTime()) / DAY_IN_MS);
  }

  private buildMessageFromTemplate(
    templateContent: string,
    params: {
      debtorName: string;
      originalAmount: number;
      dueDate: Date;
      companyName: string;
    },
  ): string {
    const valorFormatado = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(params.originalAmount);

    const dataFormatada = new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'America/Sao_Paulo',
    }).format(params.dueDate);

    const message = templateContent
      .replace(/{debtorName}/g, params.debtorName)
      .replace(/{originalAmount}/g, valorFormatado)
      .replace(/{dueDate}/g, dataFormatada)
      .replace(/{companyName}/g, params.companyName);

    return this.spintaxService.process(message);
  }
}
