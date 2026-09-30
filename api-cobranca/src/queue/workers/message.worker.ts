import {
  Injectable,
  ConflictException,
  HttpException,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BillingMethod,
  CollectionAttemptStatus,
  CollectionChannel,
  Prisma,
} from '@prisma/client';
import { Worker, Job, UnrecoverableError } from 'bullmq';
import { issuanceFailureOf } from '../../payment/efi-issuance-error';
import { WhatsappTransportError } from '../../whatsapp/transport/whatsapp-transport.error';
import { TemplatePolicyError } from '../../templates/template-contracts';
import { TemplateSendPreparerService } from '../../templates/template-send-preparer.service';
import { TemplatePendingService } from '../../communications/template-pending.service';
import { collectionLogicalKey } from '../../templates/template-selection';
import { PaymentService } from '../../payment/payment.service';
import { PublicPaymentLinkService } from '../../payment/payment-link.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from '../../whatsapp/whatsapp.service';
import { RateLimitService } from '../services/rate-limit.service';
import { MessagingLimitService } from '../services/messaging-limit.service';
import { SpintaxService } from '../services/spintax.service';
import { EmailQueueService } from '../../email/email.queue';
import { EmailService } from '../../email/email.service';
import { EmailTemplatesService } from '../../email/email-templates.service';
import {
  InitialChargeJob,
  MessageQueueService,
  SendMessageJob,
  WhatsAppQueueJob,
} from '../message.queue';

/** Template policy refusal or an intent already held for review. */
export function isTemplateHold(error: unknown): boolean {
  if (error instanceof TemplatePolicyError) return true;
  if (!(error instanceof ConflictException)) return false;
  const response = error.getResponse();
  return (
    typeof response === 'object' &&
    response !== null &&
    (response as { code?: unknown }).code === 'OUTBOUND_BLOCKED'
  );
}

interface PaymentMessageData {
  billingType: BillingMethod;
  billingTypeLabel: string;
  paymentLink: string;
  paymentPageToken: string;
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
  pixExpiresAt: Date | null;
  efiTxid: string | null;
  efiChargeId: string | null;
  efiPixCopiaECola: string | null;
  boletoLinhaDigitavel: string | null;
  boletoLink: string | null;
  boletoPdf: string | null;
  billingType: string | null;
  debtor: {
    id: string;
    name: string;
    phoneNumber: string;
    email: string | null;
    whatsappOptIn: boolean;
    useGlobalBillingSettings: boolean;
    preferredBillingMethod: BillingMethod | null;
    autoGenerateFirstCharge: boolean | null;
  };
  company: {
    corporateName: string;
    tradeName: string | null;
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
  pixExpiresAt: Date | null;
  efiTxid: string | null;
  efiChargeId: string | null;
  efiPixCopiaECola: string | null;
  boletoLinhaDigitavel: string | null;
  boletoLink: string | null;
  boletoPdf: string | null;
}

@Injectable()
export class MessageWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessageWorkerService.name);
  private worker!: Worker;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private rateLimitService: RateLimitService,
    private messagingLimitService: MessagingLimitService,
    private paymentService: PaymentService,
    private spintaxService: SpintaxService,
    private messageQueue: MessageQueueService,
    private whatsappService: WhatsappService,
    private emailQueue: EmailQueueService,
    private emailService: EmailService,
    private emailTemplatesService: EmailTemplatesService,
    private paymentLinkService: PublicPaymentLinkService,
    private templateSender: TemplateSendPreparerService,
    private templatePending: TemplatePendingService,
  ) {}

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
        concurrency: 20,
        limiter: {
          max: 60,
          duration: 1_000,
        },
      },
    );

    this.worker.on('completed', (job) => {
      this.logger.log(`Job ${job.id} completado com sucesso`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Job ${job?.id ?? 'desconhecido'} (${job?.name ?? '?'}) falhou: ${err.message}` +
          (job?.attemptsMade != null
            ? ` (tentativa ${job.attemptsMade}/${job.opts.attempts})`
            : ''),
      );
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
    if (job.name === 'outbound-intent' && 'intentId' in job.data) {
      try {
        await this.whatsappService.dispatchIntent(job.data.intentId);
      } catch (error) {
        // A template hold is durable and waits for admin review: no retry, no failure record.
        if (isTemplateHold(error)) return;
        if (!this.isDeferredDispatch(error))
          await this.recordRejectedIntent(job.data.intentId, error);
        throw error;
      }
      return;
    }
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

  /**
   * Jobs queued before the imported catalog carry a template name and parameters. They
   * never gain an implicit authorization: the communication is held for admin review.
   */
  private async processSendMessageJob(data: SendMessageJob): Promise<void> {
    const logicalKey = collectionLogicalKey(data);
    const existing = await this.prisma.communicationOutboundIntent.findFirst({
      where: { OR: [{ logicalKey }, { idempotencyKey: logicalKey }] },
      select: { id: true },
    });
    // An intent already exists: its own lifecycle (and the dispatcher's check) decides.
    if (existing) return;
    await this.prisma.$transaction((tx) =>
      this.templatePending.block(tx, {
        request: {
          logicalKey,
          origin: 'COLLECTION',
          context: {
            companyId: data.companyId,
            invoiceId: data.invoiceId,
            debtorId: data.debtorId,
          },
          selection: { mode: 'UNCONFIGURED' },
          ...(data.ruleStepId ? { ruleStepId: data.ruleStepId } : {}),
        },
        code: 'LEGACY_PAYLOAD',
      }),
    );
    await this.createCollectionLog(
      data.companyId,
      data.invoiceId,
      'WHATSAPP_TEMPLATE_HELD',
      'Mensagem WhatsApp preparada antes da troca de catalogo retida para revisao administrativa.',
      'SKIPPED',
    );
  }

  /** Technical WhatsApp failures of a rule step; template holds never reach this path. */
  private async tryEmailFallback(
    data: { companyId: string; invoiceId: string; ruleStepId?: string },
    errorMessage: string,
  ): Promise<void> {
    try {
      const shouldSkip = await this.shouldSkipInvoiceNotPending(
        data.companyId,
        data.invoiceId,
        'EMAIL',
      );
      if (shouldSkip) {
        return;
      }

      const debtor = (
        await this.prisma.invoice.findFirst({
          where: { id: data.invoiceId, companyId: data.companyId },
          select: { debtor: { select: { id: true, name: true, email: true } } },
        })
      )?.debtor;

      if (!debtor?.email) {
        this.logger.debug(
          `Fallback email descartado: devedor sem email (${data.invoiceId})`,
        );
        return;
      }

      const invoice = await this.prisma.invoice.findFirst({
        where: { id: data.invoiceId, companyId: data.companyId },
        select: {
          originalAmount: true,
          dueDate: true,
          efiPixCopiaECola: true,
          boletoLinhaDigitavel: true,
          boletoLink: true,
          billingType: true,
          debtor: { select: { name: true } },
          company: { select: { corporateName: true, tradeName: true } },
        },
      });

      if (!invoice) return;

      const amount = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(Number(invoice.originalAmount));
      const dueDate = new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'America/Sao_Paulo',
      }).format(invoice.dueDate);
      const method = invoice.billingType === 'BOLETO' ? 'BOLETO' : 'PIX';
      const paymentLink =
        invoice.efiPixCopiaECola ??
        invoice.boletoLink ??
        invoice.boletoLinhaDigitavel ??
        '';

      const html = this.emailService.buildCollectionEmailHtml({
        debtorName: invoice.debtor.name,
        companyName: invoice.company.tradeName ?? invoice.company.corporateName,
        amount,
        dueDate,
        paymentMethod: method,
        paymentLink,
        pixCopyPaste: invoice.efiPixCopiaECola ?? '',
        boletoLine: invoice.boletoLinhaDigitavel ?? '',
      });

      if (!data.ruleStepId) {
        return;
      }

      const attemptCreated = await this.createQueuedFallbackAttempt(
        data.companyId,
        data.invoiceId,
        data.ruleStepId,
        'EMAIL',
      );

      if (!attemptCreated) {
        return;
      }

      await this.emailQueue.addJob({
        companyId: data.companyId,
        invoiceId: data.invoiceId,
        debtorId: debtor.id,
        debtorName: debtor.name,
        email: debtor.email,
        subject: `[${invoice.company.tradeName ?? invoice.company.corporateName}] Cobranca pendente`,
        html,
        ruleStepId: data.ruleStepId,
      });

      this.logger.log(
        `Fallback email enfileirado para ${data.invoiceId} (WhatsApp falhou: ${errorMessage.slice(0, 80)})`,
      );
    } catch (fallbackError) {
      this.logger.error(
        `Falha ao enfileirar fallback de email para ${data.invoiceId}:`,
        fallbackError,
      );
    }
  }

  private async shouldSkipInvoiceNotPending(
    companyId: string,
    invoiceId: string,
    channel: CollectionChannel,
  ): Promise<boolean> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId },
      select: { status: true },
    });

    if (invoice?.status === 'PENDING') {
      return false;
    }

    try {
      await this.createCollectionLog(
        companyId,
        invoiceId,
        'MESSAGE_SKIPPED_INVOICE_NOT_PENDING',
        `Envio pelo canal ${channel} ignorado: fatura nao esta pendente.`,
        'SKIPPED',
      );
    } catch (error) {
      this.logger.warn(
        `Falha ao registrar skip ${channel} para fatura ${invoiceId}: ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
    }

    return true;
  }

  private async recordCollectionAttempt(
    companyId: string,
    invoiceId: string,
    ruleStepId: string | undefined,
    channel: string,
    externalMessageId: string,
  ): Promise<void> {
    if (!ruleStepId) {
      return;
    }

    await this.prisma.collectionAttempt.upsert({
      where: {
        companyId_invoiceId_ruleStepId_channel: {
          companyId,
          invoiceId,
          ruleStepId,
          channel: channel as CollectionChannel,
        },
      },
      create: {
        companyId,
        invoiceId,
        ruleStepId,
        channel: channel as CollectionChannel,
        status: 'SENT' as CollectionAttemptStatus,
        externalMessageId,
      },
      update: {
        status: 'SENT' as CollectionAttemptStatus,
        externalMessageId,
      },
    });
  }

  /** Pending, uncertain or already-processed intents are never recorded as a failed collection. */
  private isDeferredDispatch(error: unknown): boolean {
    return (
      error instanceof ConflictException ||
      (error instanceof WhatsappTransportError &&
        (error.kind === 'UNCERTAIN' ||
          error.kind === 'RATE_LIMIT' ||
          error.kind === 'TEMPORARY'))
    );
  }

  /** Intents recovered from the queue have no send-message job to record their rejection. */
  private async recordRejectedIntent(
    intentId: string,
    error: unknown,
  ): Promise<void> {
    const collection = await this.whatsappService.rejectedCollection(intentId);
    if (!collection) return;
    const errorMessage =
      error instanceof Error ? error.message : 'Erro desconhecido';
    await this.prisma.collectionLog.create({
      data: {
        companyId: collection.companyId,
        invoiceId: collection.invoiceId,
        actionType: 'WHATSAPP_SENT',
        description: `Falha no envio da fatura ${collection.invoiceId}: ${errorMessage}`,
        status: 'FAILED',
      },
    });
    await this.recordCollectionAttemptFailed(
      collection.companyId,
      collection.invoiceId,
      collection.ruleStepId,
      'WHATSAPP',
      errorMessage,
    );
    await this.tryEmailFallback(collection, errorMessage);
  }

  private async recordCollectionAttemptFailed(
    companyId: string,
    invoiceId: string,
    ruleStepId: string | undefined,
    channel: string,
    errorDetails: string,
  ): Promise<void> {
    if (!ruleStepId) {
      return;
    }

    try {
      await this.prisma.collectionAttempt.upsert({
        where: {
          companyId_invoiceId_ruleStepId_channel: {
            companyId,
            invoiceId,
            ruleStepId,
            channel: channel as CollectionChannel,
          },
        },
        create: {
          companyId,
          invoiceId,
          ruleStepId,
          channel: channel as CollectionChannel,
          status: 'FAILED' as CollectionAttemptStatus,
          errorDetails,
        },
        update: {
          status: 'FAILED' as CollectionAttemptStatus,
          errorDetails,
        },
      });
    } catch {
      // non-critical
    }
  }

  private async processInitialChargeJob(data: InitialChargeJob): Promise<void> {
    if (
      !(await this.paymentService.hasActiveFinancialProfile(data.companyId))
    ) {
      // Record the skip instead of dropping the job silently.
      await this.createCollectionLog(
        data.companyId,
        data.invoiceId,
        'INITIAL_CHARGE_SKIPPED',
        'Primeira cobranca nao gerada: ativacao financeira pendente.',
        'SKIPPED',
      );
      return;
    }
    const invoice = await this.loadInitialChargeInvoice(data);

    if (!invoice) {
      this.logger.warn(
        `Primeira cobranca ignorada: fatura ${data.invoiceId} nao encontrada.`,
      );
      return;
    }

    // The setting governs the automatic first charge (new, imported or
    // recurring invoices). A send the user selected explicitly still runs,
    // with the same financial and communication validations.
    if (
      data.source !== 'SELECTED' &&
      !this.shouldAutoGenerateFirstCharge(invoice)
    ) {
      await this.createCollectionLog(
        data.companyId,
        data.invoiceId,
        'INITIAL_CHARGE_SKIPPED',
        'Primeira cobranca automatica desativada para este devedor.',
        'SKIPPED',
      );
      return;
    }

    if (data.source !== 'SELECTED' && invoice.collectionLogs.length > 0) {
      this.logger.log(
        `Primeira cobranca da fatura ${invoice.id} ja foi enfileirada ou enviada.`,
      );
      return;
    }

    const channels = this.normalizeInitialChargeChannels(data.channels);
    const billingType = this.resolveInvoiceBillingType(invoice);
    const paymentData = await this.ensureInitialChargePayment(
      invoice,
      billingType,
    );

    let queuedCount = 0;

    if (channels.includes('WHATSAPP')) {
      if (
        !this.configService.get<string>('DATAFY_API_TOKEN') ||
        !this.configService.get<string>('META_PHONE_NUMBER_ID')
      ) {
        await this.createCollectionLog(
          invoice.companyId,
          invoice.id,
          'INITIAL_CHARGE_PAYMENT_READY',
          'Cobranca inicial gerada; canal WhatsApp (Datafy) nao configurado para envio automatico.',
          'PENDING',
        );
      } else {
        if (await this.prepareInitialWhatsapp(data, invoice)) queuedCount++;
      }
    }

    if (channels.includes('EMAIL')) {
      if (!invoice.debtor.email) {
        await this.createCollectionLog(
          invoice.companyId,
          invoice.id,
          'EMAIL_SKIPPED',
          'Cobranca por email ignorada: devedor sem email cadastrado.',
          'SKIPPED',
        );
      } else {
        const emailTemplate =
          await this.emailTemplatesService.findActiveOrDefault(
            invoice.companyId,
            null,
          );
        const personalizedEmailContent = emailTemplate.content
          .replace(/{{\s*saudacao\s*}}/g, emailTemplate.greeting)
          .replace(/{{\s*instrucoes\s*}}/g, emailTemplate.instructions)
          .replace(/{{\s*assinatura\s*}}/g, emailTemplate.signature);
        const subject = this.buildTemplateText(emailTemplate.subject, {
          debtorName: invoice.debtor.name,
          originalAmount: Number(invoice.originalAmount),
          dueDate: invoice.dueDate,
          companyName:
            invoice.company.tradeName ?? invoice.company.corporateName,
          paymentData,
        });
        const bodyText = this.ensurePaymentInstruction(
          this.buildTemplateText(personalizedEmailContent, {
            debtorName: invoice.debtor.name,
            originalAmount: Number(invoice.originalAmount),
            dueDate: invoice.dueDate,
            companyName:
              invoice.company.tradeName ?? invoice.company.corporateName,
            paymentData,
          }),
          paymentData,
        );
        const html = this.emailService.buildCollectionEmailHtml({
          debtorName: invoice.debtor.name,
          companyName:
            invoice.company.tradeName ?? invoice.company.corporateName,
          amount: new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
          }).format(Number(invoice.originalAmount)),
          dueDate: new Intl.DateTimeFormat('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            timeZone: 'America/Sao_Paulo',
          }).format(invoice.dueDate),
          paymentMethod: paymentData.billingTypeLabel,
          paymentLink: paymentData.paymentLink,
          pixCopyPaste: paymentData.pixCopiaECola,
          boletoLine: paymentData.boletoLinhaDigitavel,
          bodyText,
        });

        await this.emailQueue.addJob({
          companyId: invoice.companyId,
          invoiceId: invoice.id,
          debtorId: invoice.debtor.id,
          debtorName: invoice.debtor.name,
          email: invoice.debtor.email,
          subject,
          html,
        });

        queuedCount++;

        await this.createCollectionLog(
          invoice.companyId,
          invoice.id,
          'EMAIL_QUEUED',
          `Email de cobranca enfileirado para ${invoice.debtor.name} (${invoice.debtor.email}).`,
          'QUEUED',
        );
      }
    }

    if (queuedCount === 0) {
      this.logger.warn(`Nenhum canal enfileirado para a fatura ${invoice.id}.`);
    }
  }

  /**
   * First charge on WhatsApp: the company's EMISSION default, never another template.
   * A manual re-send of selected invoices is its own communication.
   */
  private async prepareInitialWhatsapp(
    data: InitialChargeJob,
    invoice: InitialChargeInvoice,
  ): Promise<boolean> {
    if (!invoice.debtor.whatsappOptIn) {
      await this.createCollectionLog(
        invoice.companyId,
        invoice.id,
        'WHATSAPP_OPT_IN_REQUIRED',
        `Envio oficial bloqueado para ${invoice.debtor.name}: opt-in WhatsApp ausente.`,
        'SKIPPED',
      );
      return false;
    }
    const prepared = await this.templateSender.prepare({
      logicalKey: collectionLogicalKey({
        companyId: invoice.companyId,
        invoiceId: invoice.id,
        ruleStepId:
          data.source === 'SELECTED' && data.requestId
            ? `selected-${data.requestId}`
            : null,
      }),
      origin: 'COLLECTION',
      context: {
        companyId: invoice.companyId,
        invoiceId: invoice.id,
        debtorId: invoice.debtor.id,
      },
      selection: { mode: 'DEFAULT', purpose: 'EMISSION' },
    });
    if (prepared.status === 'BLOCKED') {
      await this.createCollectionLog(
        invoice.companyId,
        invoice.id,
        'INITIAL_CHARGE_SKIPPED',
        `Primeira mensagem WhatsApp retida para revisao administrativa do template${prepared.code ? ` (${prepared.code})` : ''}.`,
        'SKIPPED',
      );
      return false;
    }
    // Persisted first: a lost enqueue is picked up by intent recovery.
    await this.messageQueue
      .addOutboundIntentJob(prepared.intentId)
      .catch(() => undefined);
    await this.createCollectionLog(
      invoice.companyId,
      invoice.id,
      'WHATSAPP_QUEUED',
      `Primeira mensagem de cobranca enfileirada para a fatura ${invoice.id}.`,
      'QUEUED',
    );
    return true;
  }

  private async loadInitialChargeInvoice(
    data: InitialChargeJob,
  ): Promise<InitialChargeInvoice | null> {
    return this.prisma.invoice.findFirst({
      where: {
        id: data.invoiceId,
        companyId: data.companyId,
        status: { in: ['DRAFT', 'PENDING'] },
      },
      select: {
        id: true,
        companyId: true,
        originalAmount: true,
        dueDate: true,
        gatewayId: true,
        pixPayload: true,
        pixExpiresAt: true,
        efiTxid: true,
        efiChargeId: true,
        efiPixCopiaECola: true,
        boletoLinhaDigitavel: true,
        boletoLink: true,
        boletoPdf: true,
        billingType: true,
        debtor: {
          select: {
            id: true,
            name: true,
            phoneNumber: true,
            email: true,
            whatsappOptIn: true,
            useGlobalBillingSettings: true,
            preferredBillingMethod: true,
            autoGenerateFirstCharge: true,
          },
        },
        company: {
          select: {
            corporateName: true,
            tradeName: true,
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

  private shouldAutoGenerateFirstCharge(
    invoice: InitialChargeInvoice,
  ): boolean {
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
          pixExpiresAt: true,
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

      // A refusal by Efí or an uncertain issuance is never retried by the
      // queue: the first would be refused again, the second waits for
      // reconciliation. The user sends again after fixing the data.
      if (this.isFinalIssuanceFailure(error))
        throw new UnrecoverableError('INITIAL_CHARGE_PAYMENT_FAILED');
      throw error;
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
      if (invoice.pixExpiresAt && invoice.pixExpiresAt <= new Date()) {
        return false;
      }

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
    const paymentPage = this.paymentLinkService.createInvoicePaymentPage({
      companyId: invoice.companyId,
      invoiceId: invoice.id,
    });

    return {
      billingType,
      billingTypeLabel: this.getBillingMethodLabel(billingType),
      paymentLink: paymentPage.url,
      paymentPageToken: paymentPage.token,
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

  private buildTemplateText(
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

    return this.spintaxService
      .process(message)
      .replace(/\{\{\s*[a-zA-Z][a-zA-Z0-9_]*\s*\}\}/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
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
      saudacao: 'Olá',
      instrucoes: 'Use o botão abaixo para acessar o pagamento seguro.',
      assinatura: `Equipe ${params.companyName}`,
    };
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

  private normalizeInitialChargeChannels(
    channels: CollectionChannel[] | undefined,
  ): CollectionChannel[] {
    const normalized = Array.from(
      new Set(
        (channels?.length ? channels : ['WHATSAPP']).filter(
          (channel): channel is CollectionChannel =>
            channel === 'EMAIL' || channel === 'WHATSAPP',
        ),
      ),
    );

    return normalized.length > 0 ? normalized : ['WHATSAPP'];
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

  private async createQueuedFallbackAttempt(
    companyId: string,
    invoiceId: string,
    ruleStepId: string,
    channel: CollectionChannel,
  ): Promise<boolean> {
    try {
      await this.prisma.collectionAttempt.create({
        data: {
          companyId,
          invoiceId,
          ruleStepId,
          channel,
          status: 'QUEUED',
        },
      });

      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return false;
      }

      throw error;
    }
  }

  // A diagnosed issuance failure, or a reservation still awaiting
  // reconciliation (EFI_SUBMISSION_UNCERTAIN): retrying cannot help.
  private isFinalIssuanceFailure(error: unknown): boolean {
    if (issuanceFailureOf(error)) return true;
    if (!(error instanceof HttpException)) return false;
    const response = error.getResponse();
    return (
      typeof response === 'object' &&
      response !== null &&
      (response as { code?: unknown }).code === 'EFI_SUBMISSION_UNCERTAIN'
    );
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
        value.source === 'SELECTED') &&
      (value.channels === undefined ||
        (Array.isArray(value.channels) &&
          value.channels.every(
            (channel) => channel === 'EMAIL' || channel === 'WHATSAPP',
          )))
    );
  }

  private isSendMessageJob(value: unknown): value is SendMessageJob {
    if (!this.isRecord(value)) {
      return false;
    }

    return (
      typeof value.invoiceId === 'string' &&
      typeof value.companyId === 'string' &&
      typeof value.debtorId === 'string' &&
      typeof value.phoneNumber === 'string' &&
      typeof value.senderKey === 'string' &&
      typeof value.templateName === 'string' &&
      typeof value.templateLanguage === 'string' &&
      Array.isArray(value.templateParameters) &&
      value.templateParameters.every(
        (parameter) => typeof parameter === 'string',
      ) &&
      (value.buttonUrlSuffix === undefined ||
        typeof value.buttonUrlSuffix === 'string') &&
      typeof value.debtorName === 'string'
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
