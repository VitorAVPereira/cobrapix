import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BillingMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MessageQueueService, SendMessageJob } from '../queue/message.queue';
import { SpintaxService } from '../queue/services/spintax.service';

const DEFAULT_COLLECTION_REMINDER_DAYS = [0];
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_AUTO_DISCOUNT_ENABLED = false;
const PLATFORM_FIXED_FEE = 0.5;

interface BillingExecutionResult {
  queued: number;
  skipped: number;
}

interface TariffDetails {
  method: BillingMethod;
  efiLabel: string;
  platformLabel: string;
  combinedLabel: string;
  efiKind: 'percentage' | 'fixed';
  efiValue: number;
  platformFixedFee: number;
}

export interface BillingSettingsResponse {
  preferredBillingMethod: BillingMethod;
  collectionReminderDays: number[];
  autoDiscountEnabled: boolean;
  autoDiscountDaysAfterDue: number | null;
  autoDiscountPercentage: number | null;
  tariffs: Record<BillingMethod, TariffDetails>;
}

interface BillingSettingsInput {
  preferredBillingMethod: BillingMethod;
  collectionReminderDays: number[];
  autoDiscountEnabled: boolean;
  autoDiscountDaysAfterDue?: number | null;
  autoDiscountPercentage?: number | null;
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
      select: {
        preferredBillingMethod: true,
        collectionReminderDays: true,
        autoDiscountEnabled: true,
        autoDiscountDaysAfterDue: true,
        autoDiscountPercentage: true,
      },
    });

    return this.buildBillingSettingsResponse(company);
  }

  async updateSettings(
    companyId: string,
    settings: BillingSettingsInput,
  ): Promise<BillingSettingsResponse> {
    const normalizedSettings = this.normalizeSettingsInput(settings);

    const company = await this.prisma.company.update({
      where: { id: companyId },
      data: {
        preferredBillingMethod: normalizedSettings.preferredBillingMethod,
        collectionReminderDays: normalizedSettings.collectionReminderDays,
        autoDiscountEnabled: normalizedSettings.autoDiscountEnabled,
        autoDiscountDaysAfterDue: normalizedSettings.autoDiscountDaysAfterDue,
        autoDiscountPercentage: normalizedSettings.autoDiscountPercentage,
      },
      select: {
        preferredBillingMethod: true,
        collectionReminderDays: true,
        autoDiscountEnabled: true,
        autoDiscountDaysAfterDue: true,
        autoDiscountPercentage: true,
      },
    });

    return this.buildBillingSettingsResponse(company);
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

  private normalizeBillingMethod(
    value: BillingMethod | null | undefined,
  ): BillingMethod {
    if (value === 'PIX' || value === 'BOLETO' || value === 'BOLIX') {
      return value;
    }

    return 'PIX';
  }

  private normalizeDiscountDays(value: number | null | undefined): number {
    if (!Number.isInteger(value) || value === undefined || value === null) {
      return 0;
    }

    if (value < 0) {
      return 0;
    }

    if (value > 365) {
      return 365;
    }

    return value;
  }

  private normalizeDiscountPercentage(
    value: number | null | undefined,
  ): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return 0;
    }

    if (value < 0.01) {
      return 0.01;
    }

    if (value > 100) {
      return 100;
    }

    return Number(value.toFixed(2));
  }

  private normalizeSettingsInput(
    settings: BillingSettingsInput,
  ): Omit<BillingSettingsResponse, 'tariffs'> {
    const autoDiscountEnabled =
      settings.autoDiscountEnabled ?? DEFAULT_AUTO_DISCOUNT_ENABLED;

    if (!autoDiscountEnabled) {
      return {
        preferredBillingMethod: this.normalizeBillingMethod(
          settings.preferredBillingMethod,
        ),
        collectionReminderDays: this.normalizeReminderDays(
          settings.collectionReminderDays,
        ),
        autoDiscountEnabled: false,
        autoDiscountDaysAfterDue: null,
        autoDiscountPercentage: null,
      };
    }

    return {
      preferredBillingMethod: this.normalizeBillingMethod(
        settings.preferredBillingMethod,
      ),
      collectionReminderDays: this.normalizeReminderDays(
        settings.collectionReminderDays,
      ),
      autoDiscountEnabled: true,
      autoDiscountDaysAfterDue: this.normalizeDiscountDays(
        settings.autoDiscountDaysAfterDue,
      ),
      autoDiscountPercentage: this.normalizeDiscountPercentage(
        settings.autoDiscountPercentage,
      ),
    };
  }

  private buildBillingSettingsResponse(
    company: {
      preferredBillingMethod?: BillingMethod | null;
      collectionReminderDays?: number[] | null;
      autoDiscountEnabled?: boolean | null;
      autoDiscountDaysAfterDue?: number | null;
      autoDiscountPercentage?: { toNumber(): number } | null;
    } | null,
  ): BillingSettingsResponse {
    const autoDiscountEnabled = company?.autoDiscountEnabled ?? false;

    return {
      preferredBillingMethod: this.normalizeBillingMethod(
        company?.preferredBillingMethod,
      ),
      collectionReminderDays: this.normalizeReminderDays(
        company?.collectionReminderDays,
      ),
      autoDiscountEnabled,
      autoDiscountDaysAfterDue: autoDiscountEnabled
        ? this.normalizeDiscountDays(company?.autoDiscountDaysAfterDue)
        : null,
      autoDiscountPercentage: autoDiscountEnabled
        ? this.normalizeDiscountPercentage(
            company?.autoDiscountPercentage?.toNumber(),
          )
        : null,
      tariffs: this.buildTariffs(),
    };
  }

  private buildTariffs(): Record<BillingMethod, TariffDetails> {
    return {
      PIX: {
        method: 'PIX',
        efiLabel: '1,19%',
        platformLabel: 'R$ 0,50',
        combinedLabel: '1,19% + R$ 0,50',
        efiKind: 'percentage',
        efiValue: 1.19,
        platformFixedFee: PLATFORM_FIXED_FEE,
      },
      BOLETO: {
        method: 'BOLETO',
        efiLabel: 'R$ 3,45',
        platformLabel: 'R$ 0,50',
        combinedLabel: 'R$ 3,95',
        efiKind: 'fixed',
        efiValue: 3.45,
        platformFixedFee: PLATFORM_FIXED_FEE,
      },
      BOLIX: {
        method: 'BOLIX',
        efiLabel: 'R$ 3,45',
        platformLabel: 'R$ 0,50',
        combinedLabel: 'R$ 3,95',
        efiKind: 'fixed',
        efiValue: 3.45,
        platformFixedFee: PLATFORM_FIXED_FEE,
      },
    };
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
