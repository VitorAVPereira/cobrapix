import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingMethod } from '@prisma/client';
import { Worker, Job } from 'bullmq';
import { normalizeWhatsAppNumberForTransport } from '../../common/whatsapp-number';
import { PaymentService } from '../../payment/payment.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RateLimitService } from '../services/rate-limit.service';
import { SpintaxService } from '../services/spintax.service';
import {
  InitialChargeJob,
  MessageQueueService,
  SendMessageJob,
  WhatsAppQueueJob,
} from '../message.queue';

const SENDER_RATE_LIMIT = {
  maxMessages: 60,
  windowMs: 60 * 60 * 1000,
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;

interface PaymentMessageData {
  billingType: BillingMethod;
  billingTypeLabel: string;
  paymentLink: string;
  pixCopiaECola: string;
  boletoLinhaDigitavel: string;
  boletoLink: string;
  boletoPdf: string;
}

interface InitialChargeInvoice {
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
  billingType: string | null;
  debtor: {
    name: string;
    phoneNumber: string;
    useGlobalBillingSettings: boolean;
    preferredBillingMethod: BillingMethod | null;
    autoGenerateFirstCharge: boolean | null;
  };
  company: {
    corporateName: string;
    preferredBillingMethod: BillingMethod;
    autoGenerateFirstCharge: boolean;
    whatsappStatus: string;
    whatsappInstanceId: string | null;
  };
  collectionLogs: Array<{ id: string }>;
}

interface InitialChargePaymentInvoice {
  id: string;
  companyId: string;
  gatewayId: string | null;
  pixPayload: string | null;
  efiTxid: string | null;
  efiChargeId: string | null;
  efiPixCopiaECola: string | null;
  boletoLinhaDigitavel: string | null;
  boletoLink: string | null;
  boletoPdf: string | null;
}

interface MessageTemplateRecord {
  slug: string;
  content: string;
}

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
    private paymentService: PaymentService,
    private spintaxService: SpintaxService,
    private messageQueue: MessageQueueService,
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
      async (job: Job<WhatsAppQueueJob>) => {
        await this.processJob(job);
      },
      {
        connection: {
          host: redisHost,
          port: redisPort,
          password: redisPassword,
        },
        concurrency: 1,
        limiter: {
          max: 1,
          duration: 10_000,
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

  private async processJob(job: Job<WhatsAppQueueJob>): Promise<void> {
    if (job.name === 'initial-charge') {
      if (!this.isInitialChargeJob(job.data)) {
        throw new Error('Payload invalido para primeira cobranca.');
      }

      await this.processInitialChargeJob(job.data);
      return;
    }

    if (!this.isSendMessageJob(job.data)) {
      throw new Error('Payload invalido para envio de mensagem.');
    }

    await this.processSendMessageJob(job.data);
  }

  private async processSendMessageJob(data: SendMessageJob): Promise<void> {
    const {
      invoiceId,
      companyId,
      phoneNumber,
      instanceName,
      message,
      debtorName,
    } = data;

    this.logger.log(`Processando mensagem para ${debtorName} (${phoneNumber})`);

    await this.enforceRateLimits(instanceName, phoneNumber);

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

  private async processInitialChargeJob(
    data: InitialChargeJob,
  ): Promise<void> {
    const invoice = await this.loadInitialChargeInvoice(data);

    if (!invoice) {
      this.logger.warn(
        `Primeira cobranca ignorada: fatura ${data.invoiceId} nao encontrada.`,
      );
      return;
    }

    if (!this.shouldAutoGenerateFirstCharge(invoice)) {
      await this.createCollectionLog(
        data.companyId,
        data.invoiceId,
        'INITIAL_CHARGE_SKIPPED',
        'Primeira cobranca automatica desativada para este devedor.',
        'SKIPPED',
      );
      return;
    }

    if (invoice.collectionLogs.length > 0) {
      this.logger.log(
        `Primeira cobranca da fatura ${invoice.id} ja foi enfileirada ou enviada.`,
      );
      return;
    }

    const billingType = this.resolveInvoiceBillingType(invoice);
    const paymentData = await this.ensureInitialChargePayment(
      invoice,
      billingType,
    );

    if (
      invoice.company.whatsappStatus !== 'CONNECTED' ||
      !invoice.company.whatsappInstanceId
    ) {
      await this.createCollectionLog(
        invoice.companyId,
        invoice.id,
        'INITIAL_CHARGE_PAYMENT_READY',
        'Cobranca inicial gerada; WhatsApp nao conectado para envio automatico.',
        'PENDING',
      );
      return;
    }

    const template = await this.findMessageTemplate(invoice);
    if (!template) {
      await this.createCollectionLog(
        invoice.companyId,
        invoice.id,
        'INITIAL_CHARGE_SKIPPED',
        'Nenhum template ativo para enviar a primeira cobranca.',
        'SKIPPED',
      );
      return;
    }

    const phoneNumber = this.normalizePhone(invoice.debtor.phoneNumber);
    const message = this.buildMessageFromTemplate(template.content, {
      debtorName: invoice.debtor.name,
      originalAmount: Number(invoice.originalAmount),
      dueDate: invoice.dueDate,
      companyName: invoice.company.corporateName,
      paymentData,
    });

    await this.messageQueue.addSendMessageJob({
      invoiceId: invoice.id,
      companyId: invoice.companyId,
      phoneNumber,
      instanceName: invoice.company.whatsappInstanceId,
      message,
      debtorName: invoice.debtor.name,
    });

    await this.createCollectionLog(
      invoice.companyId,
      invoice.id,
      'WHATSAPP_QUEUED',
      `Primeira mensagem de cobranca enfileirada para ${invoice.debtor.name} (${phoneNumber}).`,
      'QUEUED',
    );
  }

  private async loadInitialChargeInvoice(
    data: InitialChargeJob,
  ): Promise<InitialChargeInvoice | null> {
    return this.prisma.invoice.findFirst({
      where: {
        id: data.invoiceId,
        companyId: data.companyId,
        status: 'PENDING',
      },
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
        billingType: true,
        debtor: {
          select: {
            name: true,
            phoneNumber: true,
            useGlobalBillingSettings: true,
            preferredBillingMethod: true,
            autoGenerateFirstCharge: true,
          },
        },
        company: {
          select: {
            corporateName: true,
            preferredBillingMethod: true,
            autoGenerateFirstCharge: true,
            whatsappStatus: true,
            whatsappInstanceId: true,
          },
        },
        collectionLogs: {
          where: {
            actionType: { in: ['WHATSAPP_QUEUED', 'WHATSAPP_SENT'] },
            status: { in: ['QUEUED', 'SENT'] },
          },
          take: 1,
        },
      },
    });
  }

  private shouldAutoGenerateFirstCharge(invoice: InitialChargeInvoice): boolean {
    if (!invoice.debtor.useGlobalBillingSettings) {
      return invoice.debtor.autoGenerateFirstCharge ?? true;
    }

    return invoice.company.autoGenerateFirstCharge;
  }

  private async ensureInitialChargePayment(
    invoice: InitialChargeInvoice,
    billingType: BillingMethod,
  ): Promise<PaymentMessageData> {
    if (this.hasValidPaymentData(invoice, billingType)) {
      return this.buildPaymentMessageData(invoice, billingType);
    }

    try {
      await this.paymentService.createPayment(
        invoice.id,
        invoice.companyId,
        billingType,
      );

      const updatedInvoice = await this.prisma.invoice.findFirst({
        where: { id: invoice.id, companyId: invoice.companyId },
        select: {
          id: true,
          companyId: true,
          gatewayId: true,
          pixPayload: true,
          efiTxid: true,
          efiChargeId: true,
          efiPixCopiaECola: true,
          boletoLinhaDigitavel: true,
          boletoLink: true,
          boletoPdf: true,
        },
      });

      if (
        !updatedInvoice ||
        !this.hasValidPaymentData(updatedInvoice, billingType)
      ) {
        throw new Error(
          'A Efi nao retornou dados de pagamento utilizaveis para a primeira cobranca.',
        );
      }

      await this.createCollectionLog(
        invoice.companyId,
        invoice.id,
        'INITIAL_CHARGE_PAYMENT_GENERATED',
        'Cobranca Efi gerada no cadastro inicial.',
        'PENDING',
      );

      return this.buildPaymentMessageData(updatedInvoice, billingType);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'erro desconhecido';

      await this.createCollectionLog(
        invoice.companyId,
        invoice.id,
        'INITIAL_CHARGE_PAYMENT_FAILED',
        `Nao foi possivel gerar a cobranca inicial na Efi: ${errorMessage}`,
        'FAILED',
      );

      throw error;
    }
  }

  private async findMessageTemplate(
    invoice: InitialChargeInvoice,
  ): Promise<MessageTemplateRecord | null> {
    const daysFromDueDate = this.getDaysBetween(
      this.startOfDay(new Date()),
      this.startOfDay(invoice.dueDate),
    );
    const targetSlug = this.getTemplateSlugForOffset(daysFromDueDate);
    const templates = await this.prisma.messageTemplate.findMany({
      where: {
        companyId: invoice.companyId,
        slug: { in: Array.from(new Set([targetSlug, 'vencimento-hoje'])) },
        isActive: true,
      },
      select: {
        slug: true,
        content: true,
      },
    });
    const templatesBySlug = new Map(
      templates.map((template) => [template.slug, template]),
    );

    return (
      templatesBySlug.get(targetSlug) ??
      templatesBySlug.get('vencimento-hoje') ??
      templates[0] ??
      null
    );
  }

  private async enforceRateLimits(
    instanceName: string,
    phoneNumber: string,
  ): Promise<void> {
    const senderLimit = await this.rateLimitService.checkRateLimit(
      `sender:${instanceName}`,
      SENDER_RATE_LIMIT,
    );

    if (!senderLimit.allowed) {
      const delay = Math.max(senderLimit.resetAt - Date.now(), 0);
      this.logger.warn(
        `Rate limit do numero ${instanceName} atingido. Retry em ${delay}ms`,
      );
      throw new Error(`Rate limit remetente: retry after ${delay}ms`);
    }

    const recipientLimit =
      await this.rateLimitService.checkRateLimit(phoneNumber);

    if (!recipientLimit.allowed) {
      const delay = Math.max(recipientLimit.resetAt - Date.now(), 0);
      this.logger.warn(
        `Rate limit atingido para ${phoneNumber}. Retry em ${delay}ms`,
      );
      throw new Error(`Rate limit destinatario: retry after ${delay}ms`);
    }
  }

  private resolveInvoiceBillingType(
    invoice: InitialChargeInvoice,
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

    return invoice.company.preferredBillingMethod;
  }

  private hasValidPaymentData(
    invoice: InitialChargePaymentInvoice,
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
    invoice: InitialChargePaymentInvoice,
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
    if (params.billingType === 'PIX') {
      return params.pixCopiaECola;
    }

    if (params.billingType === 'BOLETO') {
      return (
        params.boletoLink || params.boletoLinhaDigitavel || params.boletoPdf
      );
    }

    return (
      params.boletoLink ||
      params.pixCopiaECola ||
      params.boletoLinhaDigitavel ||
      params.boletoPdf
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

    const replacements: Record<string, string> = {
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

  private normalizePhone(phoneNumber: string): string {
    return normalizeWhatsAppNumberForTransport(phoneNumber);
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

  private startOfDay(date: Date): Date {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  private getDaysBetween(left: Date, right: Date): number {
    return Math.round((left.getTime() - right.getTime()) / DAY_IN_MS);
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

  private isBillingMethod(value: unknown): value is BillingMethod {
    return value === 'PIX' || value === 'BOLETO' || value === 'BOLIX';
  }

  private isInitialChargeJob(value: unknown): value is InitialChargeJob {
    if (!this.isRecord(value)) {
      return false;
    }

    return (
      typeof value.invoiceId === 'string' &&
      typeof value.companyId === 'string' &&
      (value.source === 'MANUAL' ||
        value.source === 'CSV' ||
        value.source === 'RECURRING' ||
        value.source === 'SELECTED')
    );
  }

  private isSendMessageJob(value: unknown): value is SendMessageJob {
    if (!this.isRecord(value)) {
      return false;
    }

    return (
      typeof value.invoiceId === 'string' &&
      typeof value.companyId === 'string' &&
      typeof value.phoneNumber === 'string' &&
      typeof value.instanceName === 'string' &&
      typeof value.message === 'string' &&
      typeof value.debtorName === 'string'
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
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
