import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionAttemptStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import {
  formatResendFromAddress,
  ResendMailerService,
} from '../common/resend-mailer.service';

const EMAIL_PACING_MS = 100;

interface SendEmailInput {
  companyId: string;
  invoiceId: string;
  debtorId: string;
  debtorName: string;
  email: string;
  subject: string;
  html: string;
  ruleStepId?: string;
}

interface EmailStats {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
  failed: number;
}

interface SvixHeaders {
  id?: string;
  timestamp?: string;
  signature?: string;
}

interface AttemptStatusTransition {
  nextStatus: CollectionAttemptStatus;
  allowedCurrentStatuses: CollectionAttemptStatus[];
}

interface WebhookTransactionResult {
  processed: boolean;
  eventType: string;
  eventStored: boolean;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private lastSendTimestamp = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly crypto: PaymentCryptoService,
    private readonly resendMailer: ResendMailerService,
  ) {}

  async send(input: SendEmailInput): Promise<string> {
    const reusableMessageId = await this.findReusableMessageId(input);
    if (reusableMessageId) {
      return reusableMessageId;
    }

    const company = await this.prisma.company.findUnique({
      where: { id: input.companyId },
      select: {
        corporateName: true,
        resendApiKeyEncrypted: true,
        resendFromEmail: true,
      },
    });

    if (!company?.resendApiKeyEncrypted) {
      throw new Error('Resend API key nao configurada para esta empresa.');
    }

    if (!company.resendFromEmail) {
      throw new Error('Remetente Resend nao configurado para esta empresa.');
    }

    const fromEmail = formatResendFromAddress(
      company.corporateName,
      company.resendFromEmail,
    );
    const apiKey = this.crypto.decrypt(company.resendApiKeyEncrypted);

    await this.enforcePacing();

    const { id: messageId } = await this.resendMailer.sendEmail({
      apiKey,
      from: fromEmail,
      to: [input.email],
      subject: input.subject,
      html: input.html,
    });

    await this.markAttemptAsSent(input, messageId);

    this.logger.log(
      `Email enviado: ${input.debtorName} <${input.email}> — Resend ID: ${messageId}`,
    );

    return messageId;
  }

  async markAttemptAsFailed(
    input: SendEmailInput,
    errorDetails: string,
  ): Promise<void> {
    if (!input.ruleStepId) {
      return;
    }

    await this.prisma.collectionAttempt.upsert({
      where: {
        companyId_invoiceId_ruleStepId_channel: {
          companyId: input.companyId,
          invoiceId: input.invoiceId,
          ruleStepId: input.ruleStepId,
          channel: 'EMAIL',
        },
      },
      create: {
        companyId: input.companyId,
        invoiceId: input.invoiceId,
        ruleStepId: input.ruleStepId,
        channel: 'EMAIL',
        status: 'FAILED',
        errorDetails,
      },
      update: {
        status: 'FAILED',
        errorDetails,
      },
    });
  }

  async getStats(
    companyId: string,
    period: 'today' | '7d' | '30d',
  ): Promise<EmailStats> {
    const since = this.sinceDate(period);

    const [sent, delivered, opened, clicked, bounced, complained, failed] =
      await Promise.all([
        this.prisma.collectionAttempt.count({
          where: {
            companyId,
            channel: 'EMAIL',
            status: {
              in: ['SENT', 'DELIVERED', 'OPENED', 'CLICKED'],
            },
            createdAt: { gte: since },
          },
        }),
        this.prisma.emailEvent.count({
          where: {
            companyId,
            eventType: 'delivered',
            occurredAt: { gte: since },
          },
        }),
        this.prisma.emailEvent.count({
          where: {
            companyId,
            eventType: 'opened',
            occurredAt: { gte: since },
          },
        }),
        this.prisma.emailEvent.count({
          where: {
            companyId,
            eventType: 'clicked',
            occurredAt: { gte: since },
          },
        }),
        this.prisma.emailEvent.count({
          where: {
            companyId,
            eventType: 'bounced',
            occurredAt: { gte: since },
          },
        }),
        this.prisma.emailEvent.count({
          where: {
            companyId,
            eventType: 'complained',
            occurredAt: { gte: since },
          },
        }),
        this.prisma.collectionAttempt.count({
          where: {
            companyId,
            channel: 'EMAIL',
            status: 'FAILED',
            createdAt: { gte: since },
          },
        }),
      ]);

    return { sent, delivered, opened, clicked, bounced, complained, failed };
  }

  async handleWebhookEvent(
    rawBody: Buffer,
    headers: SvixHeaders,
    companyId?: string,
  ): Promise<{ processed: boolean; eventType?: string }> {
    if (!headers.id) {
      throw new Error('Webhook Resend: assinatura ausente');
    }

    const svixId = headers.id;
    const secret = await this.resolveWebhookSecret(companyId);
    const nodeEnv = this.configService.get<string>('NODE_ENV');

    if (!secret && nodeEnv === 'production') {
      throw new Error('Webhook Resend: assinatura obrigatoria em producao');
    }

    const payload = secret
      ? this.resendMailer.verifyWebhookEvent({
          payload: rawBody.toString('utf8'),
          headers,
          webhookSecret: secret,
        })
      : this.parseWebhookPayload(rawBody);

    if (!this.isRecord(payload)) {
      throw new Error('Payload webhook Resend invalido');
    }

    const eventType = this.extractString(payload, 'type');
    const emailMessageId = this.extractString(
      this.extractRecord(payload, 'data'),
      'email_id',
    );

    if (!eventType || !emailMessageId) {
      throw new Error('Payload webhook Resend sem type ou data.email_id');
    }

    const normalizedType = this.normalizeEventType(eventType);
    if (!normalizedType) {
      this.logger.debug(`Evento Resend ignorado: ${eventType}`);
      return { processed: false };
    }

    const payloadData = this.extractRecord(payload, 'data');
    const occurredAt = this.parseWebhookTimestamp(payloadData);
    const recipientEmail = this.extractRecipientEmail(payloadData);

    let transactionResult: WebhookTransactionResult;
    try {
      transactionResult = await this.prisma.$transaction(
        async (
          tx: Prisma.TransactionClient,
        ): Promise<WebhookTransactionResult> => {
          const existing = await tx.emailEvent.findUnique({
            where: { svixId },
            select: { id: true },
          });

          if (existing) {
            return {
              processed: true,
              eventType: normalizedType,
              eventStored: false,
            };
          }

          const attemptWhere: Prisma.CollectionAttemptWhereInput = {
            externalMessageId: emailMessageId,
            channel: 'EMAIL',
            ...(companyId ? { companyId } : {}),
          };

          const attempt = await tx.collectionAttempt.findFirst({
            where: attemptWhere,
            select: { companyId: true, invoiceId: true, status: true },
          });

          if (!attempt) {
            this.logger.warn(
              `Webhook Resend ignorado: tentativa nao encontrada para ${emailMessageId}`,
            );
            return {
              processed: false,
              eventType: normalizedType,
              eventStored: false,
            };
          }

          await tx.emailEvent.create({
            data: {
              companyId: attempt.companyId,
              svixId,
              emailMessageId,
              eventType: normalizedType,
              invoiceId: attempt.invoiceId,
              recipientEmail,
              rawPayload: payload as Prisma.InputJsonValue,
              occurredAt,
            },
          });

          if (this.canUpdateAttempt(normalizedType)) {
            const transition = this.mapEventToAttemptStatus(
              normalizedType,
              attempt.status,
            );
            if (transition) {
              await tx.collectionAttempt.updateMany({
                where: {
                  externalMessageId: emailMessageId,
                  companyId: attempt.companyId,
                  channel: 'EMAIL',
                  status: { in: transition.allowedCurrentStatuses },
                },
                data: { status: transition.nextStatus },
              });
            }
          }

          return {
            processed: true,
            eventType: normalizedType,
            eventStored: true,
          };
        },
      );
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        return { processed: true, eventType: normalizedType };
      }

      throw error;
    }

    if (transactionResult.eventStored) {
      this.logger.log(
        `Webhook Resend: ${normalizedType} para ${emailMessageId}`,
      );
    }

    return {
      processed: transactionResult.processed,
      eventType: transactionResult.eventType,
    };
  }

  buildCollectionEmailHtml(params: {
    debtorName: string;
    companyName: string;
    amount: string;
    dueDate: string;
    paymentMethod: string;
    paymentLink: string;
    pixCopyPaste?: string;
    boletoLine?: string;
    bodyText?: string;
  }): string {
    const paymentInstruction =
      params.paymentMethod === 'PIX'
        ? `<p style="margin:0;font-size:14px;color:#475569">Use o PIX copia e cola abaixo:</p>
           <code style="display:block;margin:8px 0;padding:12px;background:#f1f5f9;border-radius:6px;font-size:12px;word-break:break-all;color:#1e293b">${this.escapeHtml(params.pixCopyPaste ?? '')}</code>`
        : `<p style="margin:0;font-size:14px;color:#475569">Clique no botao abaixo para acessar o boleto:</p>
           <p style="margin:8px 0;font-size:12px;color:#94a3b8">Linha digitavel: ${this.escapeHtml(params.boletoLine ?? '')}</p>`;

    const bodyContent = params.bodyText
      ? this.renderEmailBodyText(params.bodyText)
      : `<p style="margin:0 0 8px;font-size:14px;color:#64748b">Ola, <strong style="color:#1e293b">${this.escapeHtml(params.debtorName)}</strong></p>
        <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.6">Segue a cobranca pendente. Clique no botao abaixo para realizar o pagamento.</p>`;

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cobranca</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
    <tr>
      <td style="padding:32px 32px 0;background:linear-gradient(135deg,#059669 0%,#047857 100%)">
        <h1 style="margin:0;font-size:20px;color:#fff;font-weight:700">${this.escapeHtml(params.companyName)}</h1>
        <p style="margin:4px 0 0;font-size:13px;color:#a7f3d0">Cobranca via ${params.paymentMethod}</p>
      </td>
    </tr>
    <tr>
      <td style="padding:32px">
        ${bodyContent}
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;margin-bottom:24px">
          <tr>
            <td style="padding:16px;border-bottom:1px solid #e2e8f0">
              <span style="font-size:12px;color:#94a3b8">Valor</span>
              <p style="margin:4px 0 0;font-size:22px;font-weight:700;color:#059669">${this.escapeHtml(params.amount)}</p>
            </td>
            <td style="padding:16px;border-bottom:1px solid #e2e8f0">
              <span style="font-size:12px;color:#94a3b8">Vencimento</span>
              <p style="margin:4px 0 0;font-size:16px;font-weight:600;color:#1e293b">${this.escapeHtml(params.dueDate)}</p>
            </td>
          </tr>
        </table>
        ${paymentInstruction}
        <a href="${this.escapeHtml(params.paymentLink)}" style="display:block;width:100%;box-sizing:border-box;background:#059669;color:#fff;text-align:center;padding:14px 24px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:600;margin-top:16px">Pagar agora</a>
        <p style="margin:16px 0 0;font-size:13px;color:#94a3b8">Se o botao nao funcionar, copie e cole este link no navegador:</p>
        <p style="margin:4px 0 0;font-size:12px;color:#64748b;word-break:break-all">${this.escapeHtml(params.paymentLink)}</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 16px">
        <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.5">Esta e uma mensagem automatica de cobranca. Em caso de duvidas, entre em contato com ${this.escapeHtml(params.companyName)}.</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private async findReusableMessageId(
    input: SendEmailInput,
  ): Promise<string | null> {
    if (!input.ruleStepId) {
      return null;
    }

    const existing = await this.prisma.collectionAttempt.findUnique({
      where: {
        companyId_invoiceId_ruleStepId_channel: {
          companyId: input.companyId,
          invoiceId: input.invoiceId,
          ruleStepId: input.ruleStepId,
          channel: 'EMAIL',
        },
      },
      select: {
        externalMessageId: true,
        status: true,
      },
    });

    if (existing?.externalMessageId && existing.status !== 'FAILED') {
      return existing.externalMessageId;
    }

    return null;
  }

  private async markAttemptAsSent(
    input: SendEmailInput,
    messageId: string,
  ): Promise<void> {
    if (!input.ruleStepId) {
      return;
    }

    await this.prisma.collectionAttempt.upsert({
      where: {
        companyId_invoiceId_ruleStepId_channel: {
          companyId: input.companyId,
          invoiceId: input.invoiceId,
          ruleStepId: input.ruleStepId,
          channel: 'EMAIL',
        },
      },
      create: {
        companyId: input.companyId,
        invoiceId: input.invoiceId,
        ruleStepId: input.ruleStepId,
        channel: 'EMAIL',
        status: 'SENT',
        externalMessageId: messageId,
      },
      update: {
        status: 'SENT',
        externalMessageId: messageId,
        errorDetails: null,
      },
    });
  }

  private async resolveWebhookSecret(
    companyId?: string,
  ): Promise<string | undefined> {
    if (!companyId) {
      return this.configService.get<string>('RESEND_WEBHOOK_SECRET');
    }

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { resendWebhookSecretEncrypted: true },
    });

    if (!company?.resendWebhookSecretEncrypted) {
      throw new Error('Webhook Resend: assinatura obrigatoria para empresa');
    }

    return this.crypto.decrypt(company.resendWebhookSecretEncrypted);
  }

  private normalizeEventType(raw: string): string | null {
    const valid: string[] = [
      'sent',
      'delivered',
      'opened',
      'clicked',
      'bounced',
      'complained',
      'failed',
      'delivery_delayed',
      'suppressed',
    ];
    const prefix = 'email.';
    const normalized = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
    return valid.includes(normalized) ? normalized : null;
  }

  private mapEventToAttemptStatus(
    eventType: string,
    currentStatus: CollectionAttemptStatus,
  ): AttemptStatusTransition | null {
    const transitions: Record<string, AttemptStatusTransition> = {
      sent: {
        nextStatus: 'SENT',
        allowedCurrentStatuses: ['QUEUED', 'SENT'],
      },
      delivered: {
        nextStatus: 'DELIVERED',
        allowedCurrentStatuses: ['QUEUED', 'SENT', 'DELIVERED'],
      },
      opened: {
        nextStatus: 'OPENED',
        allowedCurrentStatuses: ['QUEUED', 'SENT', 'DELIVERED', 'OPENED'],
      },
      clicked: {
        nextStatus: 'CLICKED',
        allowedCurrentStatuses: [
          'QUEUED',
          'SENT',
          'DELIVERED',
          'OPENED',
          'CLICKED',
        ],
      },
      bounced: {
        nextStatus: 'FAILED',
        allowedCurrentStatuses: [
          'QUEUED',
          'SENT',
          'DELIVERED',
          'OPENED',
          'FAILED',
        ],
      },
      complained: {
        nextStatus: 'FAILED',
        allowedCurrentStatuses: [
          'QUEUED',
          'SENT',
          'DELIVERED',
          'OPENED',
          'FAILED',
        ],
      },
      failed: {
        nextStatus: 'FAILED',
        allowedCurrentStatuses: [
          'QUEUED',
          'SENT',
          'DELIVERED',
          'OPENED',
          'FAILED',
        ],
      },
      suppressed: {
        nextStatus: 'FAILED',
        allowedCurrentStatuses: [
          'QUEUED',
          'SENT',
          'DELIVERED',
          'OPENED',
          'FAILED',
        ],
      },
    };
    const transition = transitions[eventType];

    if (!transition?.allowedCurrentStatuses.includes(currentStatus)) {
      return null;
    }

    return transition;
  }

  private canUpdateAttempt(eventType: string): boolean {
    return [
      'sent',
      'delivered',
      'opened',
      'clicked',
      'bounced',
      'complained',
      'failed',
      'suppressed',
    ].includes(eventType);
  }

  private isUniqueConstraintError(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return error.code === 'P2002';
    }

    if (!this.isRecord(error)) {
      return false;
    }

    return (
      this.extractString(error, 'name') === 'PrismaClientKnownRequestError' &&
      this.extractString(error, 'code') === 'P2002'
    );
  }

  private async enforcePacing(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastSendTimestamp;
    if (elapsed < EMAIL_PACING_MS) {
      await new Promise((resolve) =>
        setTimeout(resolve, EMAIL_PACING_MS - elapsed),
      );
    }
    this.lastSendTimestamp = Date.now();
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private renderEmailBodyText(text: string): string {
    return text
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph.length > 0)
      .map(
        (paragraph) =>
          `<p style="margin:0 0 16px;font-size:14px;color:#475569;line-height:1.6;white-space:pre-line">${this.escapeHtml(paragraph)}</p>`,
      )
      .join('');
  }

  private sinceDate(period: 'today' | '7d' | '30d'): Date {
    const now = new Date();
    switch (period) {
      case 'today':
        now.setHours(0, 0, 0, 0);
        return now;
      case '7d':
        now.setDate(now.getDate() - 7);
        return now;
      case '30d':
        now.setDate(now.getDate() - 30);
        return now;
    }
  }

  private parseWebhookTimestamp(data: Record<string, unknown> | null): Date {
    const created = this.extractString(data, 'created_at');
    const date = created ? new Date(created) : new Date();

    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  private parseWebhookPayload(rawBody: Buffer): Record<string, unknown> {
    try {
      const payload = JSON.parse(rawBody.toString('utf8')) as unknown;

      if (this.isRecord(payload)) {
        return payload;
      }
    } catch {
      throw new Error('Payload webhook Resend invalido: JSON mal formado');
    }

    throw new Error('Payload webhook Resend invalido');
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private extractString(
    obj: Record<string, unknown> | null,
    key: string,
  ): string | null {
    const value = obj?.[key];
    return typeof value === 'string' ? value : null;
  }

  private extractRecord(
    obj: Record<string, unknown> | null,
    key: string,
  ): Record<string, unknown> | null {
    const value = obj?.[key];
    return this.isRecord(value) ? value : null;
  }

  private extractRecipientEmail(data: Record<string, unknown> | null): string {
    const to = data?.to;

    if (typeof to === 'string') {
      return to;
    }

    if (Array.isArray(to)) {
      const first = to.find((item): item is string => typeof item === 'string');

      if (first) {
        return first;
      }
    }

    return 'unknown';
  }
}
