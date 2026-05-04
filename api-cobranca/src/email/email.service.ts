import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionAttemptStatus, Prisma } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';

const RESEND_API = 'https://api.resend.com';
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

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private lastSendTimestamp = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly crypto: PaymentCryptoService,
  ) {}

  async send(input: SendEmailInput): Promise<string> {
    const reusableMessageId = await this.findReusableMessageId(input);
    if (reusableMessageId) {
      return reusableMessageId;
    }

    const company = await this.prisma.company.findUnique({
      where: { id: input.companyId },
      select: { resendApiKeyEncrypted: true, resendFromEmail: true },
    });

    if (!company?.resendApiKeyEncrypted) {
      throw new Error('Resend API key nao configurada para esta empresa.');
    }

    const fromEmail = company.resendFromEmail ?? this.defaultFromEmail();
    const apiKey = this.crypto.decrypt(company.resendApiKeyEncrypted);

    await this.enforcePacing();

    const response = await fetch(`${RESEND_API}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [input.email],
        subject: input.subject,
        html: input.html,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Resend API: falha (${response.status}): ${body}`);
    }

    const result = (await response.json()) as { id?: string };
    const messageId = result.id;

    if (!messageId) {
      throw new Error('Resend API: resposta sem ID de mensagem');
    }

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
  ): Promise<{ processed: boolean; eventType?: string }> {
    const secret = this.configService.get<string>('RESEND_WEBHOOK_SECRET');
    if (secret) {
      this.verifySvixSignature(rawBody, headers, secret);
    }

    if (!headers.id) {
      throw new Error('Webhook Resend sem svix-id');
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new Error('Payload webhook Resend invalido: JSON mal formado');
    }

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

    const existing = await this.prisma.emailEvent.findUnique({
      where: { svixId: headers.id },
      select: { id: true },
    });

    if (existing) {
      return { processed: true, eventType: normalizedType };
    }

    const attempt = await this.prisma.collectionAttempt.findFirst({
      where: { externalMessageId: emailMessageId, channel: 'EMAIL' },
      select: { companyId: true, invoiceId: true, status: true },
    });

    if (!attempt) {
      this.logger.warn(
        `Webhook Resend ignorado: tentativa nao encontrada para ${emailMessageId}`,
      );
      return { processed: false, eventType: normalizedType };
    }

    const occurredAt = this.parseWebhookTimestamp(
      this.extractRecord(payload, 'data'),
    );

    await this.prisma.emailEvent.create({
      data: {
        companyId: attempt.companyId,
        svixId: headers.id,
        emailMessageId,
        eventType: normalizedType,
        invoiceId: attempt.invoiceId,
        recipientEmail: this.extractRecipientEmail(
          this.extractRecord(payload, 'data'),
        ),
        rawPayload: payload as Prisma.InputJsonValue,
        occurredAt,
      },
    });

    if (attempt && this.canUpdateAttempt(normalizedType)) {
      const newStatus = this.mapEventToAttemptStatus(
        normalizedType,
        attempt.status,
      );
      if (newStatus) {
        await this.prisma.collectionAttempt.updateMany({
          where: { externalMessageId: emailMessageId },
          data: { status: newStatus as CollectionAttemptStatus },
        });
      }
    }

    this.logger.log(`Webhook Resend: ${normalizedType} para ${emailMessageId}`);

    return { processed: true, eventType: normalizedType };
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

    if (
      existing?.externalMessageId &&
      existing.status !== 'FAILED'
    ) {
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

  private verifySvixSignature(
    rawBody: Buffer,
    headers: SvixHeaders,
    secret: string,
  ): void {
    if (!headers.id || !headers.timestamp || !headers.signature) {
      throw new Error('Webhook Resend: assinatura ausente');
    }

    const timestamp = headers.timestamp;
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
      throw new Error('Webhook Resend: timestamp fora do intervalo permitido');
    }

    const signedContent = `${headers.id}.${timestamp}.${rawBody.toString('utf8')}`;
    const computed = createHmac('sha256', this.decodeSvixSecret(secret))
      .update(signedContent)
      .digest('base64');

    const signatures = this.extractSvixSignatures(headers.signature);
    const valid = signatures.some((signature) =>
      this.safeEqual(signature, computed),
    );

    if (!valid) {
      throw new Error('Webhook Resend: assinatura invalida');
    }
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
  ): string | null {
    if (currentStatus === 'CLICKED') {
      return null;
    }

    if (currentStatus === 'OPENED' && eventType === 'delivered') {
      return null;
    }

    const map: Record<string, string> = {
      sent: 'SENT',
      delivered: 'DELIVERED',
      opened: 'OPENED',
      clicked: 'CLICKED',
      bounced: 'FAILED',
      failed: 'FAILED',
    };
    return map[eventType] ?? null;
  }

  private canUpdateAttempt(eventType: string): boolean {
    return ['sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed'].includes(
      eventType,
    );
  }

  private decodeSvixSecret(secret: string): Buffer {
    if (secret.startsWith('whsec_')) {
      return Buffer.from(secret.slice('whsec_'.length), 'base64');
    }

    return Buffer.from(secret, 'utf8');
  }

  private extractSvixSignatures(signatureHeader: string): string[] {
    return signatureHeader
      .split(' ')
      .map((part) => part.trim())
      .map((part) => part.split(','))
      .filter(([version, signature]) => version === 'v1' && Boolean(signature))
      .map(([, signature]) => signature)
      .filter((signature): signature is string => Boolean(signature));
  }

  private safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left, 'utf8');
    const rightBuffer = Buffer.from(right, 'utf8');

    return (
      leftBuffer.length === rightBuffer.length &&
      timingSafeEqual(leftBuffer, rightBuffer)
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

  private defaultFromEmail(): string {
    return (
      this.configService.get<string>('RESEND_FROM_EMAIL') ??
      'cobranca@cobrapix.com'
    );
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
