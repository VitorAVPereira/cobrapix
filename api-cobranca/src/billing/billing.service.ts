import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BillingMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentService } from '../payment/payment.service';
import { MessageQueueService, SendMessageJob } from '../queue/message.queue';
import { SpintaxService } from '../queue/services/spintax.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

const DEFAULT_COLLECTION_REMINDER_DAYS = [0];
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_AUTO_GENERATE_FIRST_CHARGE = true;
const DEFAULT_AUTO_DISCOUNT_ENABLED = false;
const PLATFORM_FIXED_FEE = 0.5;

interface BillingExecutionResult {
  queued: number;
  skipped: number;
}

interface SelectedBillingExecutionResult extends BillingExecutionResult {
  requested: number;
}

type DashboardPeriod = 'today' | '7d' | '30d' | 'year';

export interface BillingMetricsResponse {
  period: DashboardPeriod;
  activeCharges: number;
  pendingAmount: number;
  recoveredAmount: number;
  recoveryRate: number;
  paidCharges: number;
  overdueCharges: number;
  generatedPayments: number;
  queuedMessages: number;
  sentMessages: number;
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
  autoGenerateFirstCharge: boolean;
  autoDiscountEnabled: boolean;
  autoDiscountDaysAfterDue: number | null;
  autoDiscountPercentage: number | null;
  tariffs: Record<BillingMethod, TariffDetails>;
}

interface BillingSettingsInput {
  preferredBillingMethod: BillingMethod;
  collectionReminderDays: number[];
  autoGenerateFirstCharge: boolean;
  autoDiscountEnabled: boolean;
  autoDiscountDaysAfterDue?: number | null;
  autoDiscountPercentage?: number | null;
}

interface ScheduledInvoice {
  id: string;
  companyId: string;
  originalAmount: unknown;
  dueDate: Date;
  gatewayId: string | null;
  pixPayload: string | null;
  efiTxid: string | null;
  efiChargeId: string | null;
  efiPixCopiaECola: string | null;
  boletoLinhaDigitavel: string | null;
  boletoLink: string | null;
  boletoPdf: string | null;
  pixExpiresAt: Date | null;
  billingType: string | null;
  debtor: {
    id: string;
    name: string;
    phoneNumber: string;
    whatsappOptIn: boolean;
    useGlobalBillingSettings: boolean;
    preferredBillingMethod: BillingMethod | null;
  };
  collectionLogs: Array<{ id: string }>;
}

interface PaymentMessageData {
  billingType: BillingMethod;
  billingTypeLabel: string;
  paymentLink: string;
  pixCopiaECola: string;
  boletoLinhaDigitavel: string;
  boletoLink: string;
  boletoPdf: string;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private isRunning = false;

  constructor(
    private prisma: PrismaService,
    private messageQueue: MessageQueueService,
    private spintaxService: SpintaxService,
    private paymentService: PaymentService,
    private whatsappService?: WhatsappService,
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

  async enqueueSelectedInvoices(
    companyId: string,
    invoiceIds: string[],
  ): Promise<SelectedBillingExecutionResult> {
    const uniqueInvoiceIds = Array.from(new Set(invoiceIds));

    if (uniqueInvoiceIds.length === 0) {
      return { requested: 0, queued: 0, skipped: 0 };
    }

    const pendingInvoices = await this.prisma.invoice.findMany({
      where: {
        companyId,
        id: { in: uniqueInvoiceIds },
        status: 'PENDING',
      },
      select: {
        id: true,
      },
    });

    if (pendingInvoices.length > 0) {
      await this.messageQueue.addSelectedInitialChargeJobs(
        pendingInvoices.map((invoice) => ({
          invoiceId: invoice.id,
          companyId,
          source: 'SELECTED',
        })),
      );
    }

    return {
      requested: uniqueInvoiceIds.length,
      queued: pendingInvoices.length,
      skipped: uniqueInvoiceIds.length - pendingInvoices.length,
    };
  }

  async getMetrics(
    companyId: string,
    periodInput?: string,
  ): Promise<BillingMetricsResponse> {
    const period = this.normalizeDashboardPeriod(periodInput);
    const range = this.getDashboardPeriodRange(period);
    const now = new Date();

    const [
      activeCharges,
      pendingAggregate,
      recoveredAggregate,
      paidCharges,
      overdueCharges,
      generatedPayments,
      queuedMessages,
      sentMessages,
    ] = await Promise.all([
      this.prisma.invoice.count({
        where: { companyId, status: 'PENDING' },
      }),
      this.prisma.invoice.aggregate({
        where: { companyId, status: 'PENDING' },
        _sum: { originalAmount: true },
      }),
      this.prisma.invoice.aggregate({
        where: {
          companyId,
          status: 'PAID',
          updatedAt: { gte: range.start, lte: range.end },
        },
        _sum: { originalAmount: true },
      }),
      this.prisma.invoice.count({
        where: {
          companyId,
          status: 'PAID',
          updatedAt: { gte: range.start, lte: range.end },
        },
      }),
      this.prisma.invoice.count({
        where: {
          companyId,
          status: 'PENDING',
          dueDate: { lt: this.startOfDay(now) },
        },
      }),
      this.prisma.collectionLog.count({
        where: {
          companyId,
          actionType: {
            in: [
              'PAYMENT_GENERATED',
              'PAYMENT_REUSED',
              'INITIAL_CHARGE_PAYMENT_GENERATED',
              'INITIAL_CHARGE_PAYMENT_READY',
              'EFI_PIX_CREATED',
              'EFI_BOLETO_CREATED',
              'EFI_BOLIX_CREATED',
            ],
          },
          createdAt: { gte: range.start, lte: range.end },
        },
      }),
      this.prisma.collectionLog.count({
        where: {
          companyId,
          actionType: 'WHATSAPP_QUEUED',
          status: 'QUEUED',
          createdAt: { gte: range.start, lte: range.end },
        },
      }),
      this.prisma.collectionLog.count({
        where: {
          companyId,
          actionType: 'WHATSAPP_SENT',
          status: 'SENT',
          createdAt: { gte: range.start, lte: range.end },
        },
      }),
    ]);

    const pendingAmount = this.decimalToNumber(
      pendingAggregate._sum.originalAmount,
    );
    const recoveredAmount = this.decimalToNumber(
      recoveredAggregate._sum.originalAmount,
    );
    const recoveryBase = pendingAmount + recoveredAmount;

    return {
      period,
      activeCharges,
      pendingAmount,
      recoveredAmount,
      recoveryRate:
        recoveryBase > 0
          ? Number(((recoveredAmount / recoveryBase) * 100).toFixed(1))
          : 0,
      paidCharges,
      overdueCharges,
      generatedPayments,
      queuedMessages,
      sentMessages,
    };
  }

  async getSettings(companyId: string): Promise<BillingSettingsResponse> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        preferredBillingMethod: true,
        collectionReminderDays: true,
        autoGenerateFirstCharge: true,
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
        autoGenerateFirstCharge: normalizedSettings.autoGenerateFirstCharge,
        autoDiscountEnabled: normalizedSettings.autoDiscountEnabled,
        autoDiscountDaysAfterDue: normalizedSettings.autoDiscountDaysAfterDue,
        autoDiscountPercentage: normalizedSettings.autoDiscountPercentage,
      },
      select: {
        preferredBillingMethod: true,
        collectionReminderDays: true,
        autoGenerateFirstCharge: true,
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
              actionType: { in: ['WHATSAPP_QUEUED', 'WHATSAPP_SENT'] },
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

        const paymentData = await this.ensureInvoicePayment(invoice, company);
        if (!paymentData) {
          skippedCount++;
          continue;
        }

        let phone = invoice.debtor.phoneNumber;
        if (!phone.startsWith('55')) {
          phone = `55${phone}`;
        }

        const templateSlug = this.getTemplateSlugForOffset(daysFromDueDate);
        const template = templatesBySlug.get(templateSlug) ?? fallbackTemplate;
        const replacements = this.buildTemplateReplacements({
          debtorName: invoice.debtor.name,
          originalAmount: Number(invoice.originalAmount),
          dueDate: invoice.dueDate,
          companyName: company.corporateName,
          paymentData,
        });
        const templateParameters = this.whatsappService?.buildTemplateParameters
          ? this.whatsappService.buildTemplateParameters(
              template.content,
              replacements,
            )
          : this.buildTemplateParameters(template.content, replacements);
        const templateName =
          template.metaTemplateName ??
          this.whatsappService?.buildMetaTemplateName(template.slug) ??
          this.buildMetaTemplateName(template.slug);
        const message = this.buildMessageFromTemplate(template.content, {
          debtorName: invoice.debtor.name,
          originalAmount: Number(invoice.originalAmount),
          dueDate: invoice.dueDate,
          companyName: company.corporateName,
          paymentData,
        });

        jobs.push({
          invoiceId: invoice.id,
          companyId: company.id,
          debtorId: invoice.debtor.id,
          phoneNumber: phone,
          senderKey: company.whatsappInstanceId,
          templateName,
          templateLanguage: template.metaLanguage,
          templateParameters,
          message,
          debtorName: invoice.debtor.name,
        });
      }

      if (jobs.length > 0) {
        await this.messageQueue.addBulkSendMessageJobs(jobs);
        await this.logQueuedMessages(jobs);
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

  private async ensureInvoicePayment(
    invoice: ScheduledInvoice,
    company: {
      id: string;
      preferredBillingMethod: BillingMethod;
    },
  ): Promise<PaymentMessageData | null> {
    const billingType = this.resolveInvoiceBillingType(invoice, company);

    if (this.hasValidPaymentData(invoice, billingType)) {
      await this.createCollectionLog(
        company.id,
        invoice.id,
        'PAYMENT_REUSED',
        'Cobranca existente reutilizada para mensagem automatica.',
        'PENDING',
      );
      return this.buildPaymentMessageData(invoice, billingType);
    }

    try {
      await this.paymentService.createPayment(
        invoice.id,
        company.id,
        billingType,
      );

      const updatedInvoice = await this.prisma.invoice.findFirst({
        where: { id: invoice.id, companyId: company.id },
        select: {
          id: true,
          companyId: true,
          originalAmount: true,
          dueDate: true,
          gatewayId: true,
          pixPayload: true,
          efiTxid: true,
          efiChargeId: true,
          efiPixCopiaECola: true,
          boletoLinhaDigitavel: true,
          boletoLink: true,
          boletoPdf: true,
          pixExpiresAt: true,
          billingType: true,
        },
      });

      if (
        !updatedInvoice ||
        !this.hasValidPaymentData(updatedInvoice, billingType)
      ) {
        await this.createCollectionLog(
          company.id,
          invoice.id,
          'PAYMENT_GENERATION_FAILED',
          'A Efi criou a cobranca, mas nao retornou dados de pagamento utilizaveis.',
          'FAILED',
        );
        return null;
      }

      await this.createCollectionLog(
        company.id,
        invoice.id,
        'PAYMENT_GENERATED',
        'Cobranca Efi gerada antes do envio automatico.',
        'PENDING',
      );

      return this.buildPaymentMessageData(updatedInvoice, billingType);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'erro desconhecido';

      await this.createCollectionLog(
        company.id,
        invoice.id,
        'PAYMENT_GENERATION_FAILED',
        `Nao foi possivel gerar a cobranca na Efi: ${errorMessage}`,
        'FAILED',
      );

      this.logger.warn(
        `Fatura ${invoice.id}: falha ao gerar pagamento ${billingType}: ${errorMessage}`,
      );
      return null;
    }
  }

  private resolveInvoiceBillingType(
    invoice: ScheduledInvoice,
    company: { preferredBillingMethod: BillingMethod | null },
  ): BillingMethod {
    if (this.isBillingMethod(invoice.billingType)) {
      return invoice.billingType;
    }

    if (
      !invoice.debtor.useGlobalBillingSettings &&
      this.isBillingMethod(invoice.debtor.preferredBillingMethod)
    ) {
      return invoice.debtor.preferredBillingMethod;
    }

    return this.normalizeBillingMethod(company.preferredBillingMethod);
  }

  private isBillingMethod(value: unknown): value is BillingMethod {
    return value === 'PIX' || value === 'BOLETO' || value === 'BOLIX';
  }

  private hasValidPaymentData(
    invoice: {
      gatewayId: string | null;
      pixPayload: string | null;
      efiTxid: string | null;
      efiChargeId: string | null;
      efiPixCopiaECola: string | null;
      boletoLinhaDigitavel: string | null;
      boletoLink: string | null;
    },
    billingType: BillingMethod,
  ): boolean {
    if (billingType === 'PIX') {
      return Boolean(
        invoice.gatewayId &&
        invoice.efiTxid &&
        (invoice.pixPayload || invoice.efiPixCopiaECola),
      );
    }

    return Boolean(
      invoice.gatewayId &&
      invoice.efiChargeId &&
      (invoice.boletoLink || invoice.boletoLinhaDigitavel),
    );
  }

  private buildPaymentMessageData(
    invoice: {
      pixPayload: string | null;
      efiPixCopiaECola: string | null;
      boletoLinhaDigitavel: string | null;
      boletoLink: string | null;
      boletoPdf: string | null;
    },
    billingType: BillingMethod,
  ): PaymentMessageData {
    const pixCopiaECola = invoice.efiPixCopiaECola ?? invoice.pixPayload ?? '';
    const boletoLink = invoice.boletoLink ?? '';
    const boletoLinhaDigitavel = invoice.boletoLinhaDigitavel ?? '';
    const boletoPdf = invoice.boletoPdf ?? '';

    return {
      billingType,
      billingTypeLabel: this.getBillingMethodLabel(billingType),
      paymentLink: this.resolvePaymentLink({
        billingType,
        pixCopiaECola,
        boletoLinhaDigitavel,
        boletoLink,
        boletoPdf,
      }),
      pixCopiaECola,
      boletoLinhaDigitavel,
      boletoLink,
      boletoPdf,
    };
  }

  private resolvePaymentLink(params: {
    billingType: BillingMethod;
    pixCopiaECola: string;
    boletoLinhaDigitavel: string;
    boletoLink: string;
    boletoPdf: string;
  }): string {
    const { billingType, pixCopiaECola, boletoLinhaDigitavel, boletoLink } =
      params;

    if (billingType === 'PIX') {
      return pixCopiaECola;
    }

    if (billingType === 'BOLETO') {
      return boletoLink || boletoLinhaDigitavel || params.boletoPdf;
    }

    return (
      boletoLink || pixCopiaECola || boletoLinhaDigitavel || params.boletoPdf
    );
  }

  private getBillingMethodLabel(billingType: BillingMethod): string {
    const labels: Record<BillingMethod, string> = {
      PIX: 'PIX',
      BOLETO: 'Boleto',
      BOLIX: 'Bolix',
    };

    return labels[billingType];
  }

  private async logQueuedMessages(jobs: SendMessageJob[]): Promise<void> {
    await Promise.all(
      jobs.map((job) =>
        this.createCollectionLog(
          job.companyId,
          job.invoiceId,
          'WHATSAPP_QUEUED',
          `Mensagem de cobranca enfileirada para ${job.debtorName} (${job.phoneNumber}).`,
          'QUEUED',
        ),
      ),
    );
  }

  private async createCollectionLog(
    companyId: string,
    invoiceId: string,
    actionType: string,
    description: string,
    status: string,
  ): Promise<void> {
    await this.prisma.collectionLog.create({
      data: {
        companyId,
        invoiceId,
        actionType,
        description,
        status,
      },
    });
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
        autoGenerateFirstCharge:
          settings.autoGenerateFirstCharge ??
          DEFAULT_AUTO_GENERATE_FIRST_CHARGE,
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
      autoGenerateFirstCharge:
        settings.autoGenerateFirstCharge ?? DEFAULT_AUTO_GENERATE_FIRST_CHARGE,
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
      autoGenerateFirstCharge?: boolean | null;
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
      autoGenerateFirstCharge:
        company?.autoGenerateFirstCharge ?? DEFAULT_AUTO_GENERATE_FIRST_CHARGE,
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

  private normalizeDashboardPeriod(value?: string): DashboardPeriod {
    if (value === 'today' || value === '7d' || value === '30d') {
      return value;
    }

    if (value === 'year') {
      return 'year';
    }

    return '30d';
  }

  private getDashboardPeriodRange(period: DashboardPeriod): {
    start: Date;
    end: Date;
  } {
    const now = new Date();
    const end = this.endOfDay(now);

    if (period === 'today') {
      return {
        start: this.startOfDay(now),
        end,
      };
    }

    if (period === '7d') {
      return {
        start: this.startOfDay(this.addDays(now, -6)),
        end,
      };
    }

    if (period === 'year') {
      return {
        start: new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0),
        end,
      };
    }

    return {
      start: this.startOfDay(this.addDays(now, -29)),
      end,
    };
  }

  private decimalToNumber(value: Prisma.Decimal | null): number {
    return value ? Number(value.toNumber().toFixed(2)) : 0;
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
      paymentData: PaymentMessageData;
    },
  ): string {
    const replacements = this.buildTemplateReplacements(params);
    const contentWithoutEmptyPaymentLines = this.removeEmptyVariableLines(
      templateContent,
      replacements,
    );

    const message = Object.entries(replacements).reduce(
      (content, [key, value]) =>
        content
          .replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), value)
          .replace(new RegExp(`{${key}}`, 'g'), value),
      contentWithoutEmptyPaymentLines,
    );

    const processedMessage = this.spintaxService
      .process(message)
      .replace(/\{\{\s*[a-zA-Z][a-zA-Z0-9_]*\s*\}\}/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return this.ensurePaymentInstruction(processedMessage, params.paymentData);
  }

  private buildTemplateReplacements(params: {
    debtorName: string;
    originalAmount: number;
    dueDate: Date;
    companyName: string;
    paymentData: PaymentMessageData;
  }): Record<string, string> {
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

    return {
      debtorName: params.debtorName,
      originalAmount: valorFormatado,
      dueDate: dataFormatada,
      companyName: params.companyName,
      payment_link: params.paymentData.paymentLink,
      pix_copia_e_cola: params.paymentData.pixCopiaECola,
      boleto_linha_digitavel: params.paymentData.boletoLinhaDigitavel,
      boleto_link: params.paymentData.boletoLink,
      boleto_pdf: params.paymentData.boletoPdf,
      billing_type: params.paymentData.billingType,
      metodo_pagamento: params.paymentData.billingTypeLabel,
      valor: valorFormatado,
      data_vencimento: dataFormatada,
      nome_devedor: params.debtorName,
      nome_empresa: params.companyName,
    };
  }

  private buildTemplateParameters(
    templateContent: string,
    replacements: Record<string, string>,
  ): string[] {
    return Array.from(
      templateContent.matchAll(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g),
    )
      .map((match) => match[1])
      .filter((variableName): variableName is string => Boolean(variableName))
      .map((variableName) => replacements[variableName] ?? '');
  }

  private buildMetaTemplateName(slug: string): string {
    return `cobrapix_${slug}`
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private ensurePaymentInstruction(
    message: string,
    paymentData: PaymentMessageData,
  ): string {
    const paymentValues = [
      paymentData.paymentLink,
      paymentData.pixCopiaECola,
      paymentData.boletoLinhaDigitavel,
      paymentData.boletoLink,
      paymentData.boletoPdf,
    ].filter((value) => value !== '');

    if (paymentValues.some((value) => message.includes(value))) {
      return message;
    }

    return [
      message,
      '',
      `Forma de pagamento: ${paymentData.billingTypeLabel}`,
      `Acesse/pague por aqui: ${paymentData.paymentLink}`,
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  private removeEmptyVariableLines(
    content: string,
    replacements: Record<string, string>,
  ): string {
    return content
      .split('\n')
      .filter((line) => !this.hasEmptyTemplateVariable(line, replacements))
      .join('\n');
  }

  private hasEmptyTemplateVariable(
    line: string,
    replacements: Record<string, string>,
  ): boolean {
    const variables = Array.from(
      line.matchAll(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g),
    )
      .map((match) => match[1])
      .filter((variable): variable is string => typeof variable === 'string');

    return variables.some((variable) => replacements[variable] === '');
  }
}
