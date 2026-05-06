import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentNotificationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from './payment-crypto.service';

const RESEND_API = 'https://api.resend.com';

interface PaidInvoiceRecord {
  id: string;
  companyId: string;
  originalAmount: { toNumber(): number };
  dueDate: Date;
  status: string;
  paidAt: Date | null;
  billingType: string;
  studentName: string | null;
  studentEnrollment: string | null;
  studentGroup: string | null;
  debtor: {
    id: string;
    name: string;
    email: string | null;
  };
  company: {
    corporateName: string;
    email: string;
    paymentNotificationEnabled: boolean;
    paymentNotificationEmails: string[];
    resendApiKeyEncrypted: string | null;
    resendFromEmail: string | null;
  };
}

interface PaymentNotificationListRecord {
  id: string;
  invoiceId: string;
  status: PaymentNotificationStatus;
  recipientEmails: string[];
  errorMessage: string | null;
  summary: Prisma.JsonValue;
  sentAt: Date | null;
  readAt: Date | null;
  createdAt: Date;
  invoice: {
    originalAmount: { toNumber(): number };
    dueDate: Date;
    paidAt: Date | null;
    billingType: string;
    studentName: string | null;
    studentEnrollment: string | null;
    studentGroup: string | null;
    debtor: {
      name: string;
      email: string | null;
    };
  };
}

export interface PaymentNotificationListItem {
  id: string;
  invoiceId: string;
  status: PaymentNotificationStatus;
  recipientEmails: string[];
  errorMessage: string | null;
  debtorName: string;
  debtorEmail: string | null;
  amount: number;
  billingType: string;
  dueDate: string;
  paidAt: string | null;
  studentName: string | null;
  studentEnrollment: string | null;
  studentGroup: string | null;
  sentAt: string | null;
  readAt: string | null;
  createdAt: string;
  summary: Prisma.JsonValue;
}

export interface PaymentNotificationListResponse {
  data: PaymentNotificationListItem[];
  unreadCount: number;
}

@Injectable()
export class PaymentNotificationsService {
  private readonly logger = new Logger(PaymentNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly crypto: PaymentCryptoService,
  ) {}

  async notifyPaidInvoice(companyId: string, invoiceId: string): Promise<void> {
    const existing = await this.prisma.paymentNotification.findFirst({
      where: { companyId, invoiceId },
      select: { id: true },
    });

    if (existing) {
      return;
    }

    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId },
      include: {
        debtor: {
          select: { id: true, name: true, email: true },
        },
        company: {
          select: {
            corporateName: true,
            email: true,
            paymentNotificationEnabled: true,
            paymentNotificationEmails: true,
            resendApiKeyEncrypted: true,
            resendFromEmail: true,
          },
        },
      },
    });

    if (!invoice || invoice.status !== 'PAID') {
      return;
    }

    const paidAt = invoice.paidAt ?? new Date();
    const recipients = this.resolveRecipients(
      invoice.company.paymentNotificationEmails,
      invoice.company.email,
    );
    const summary = this.buildPaymentSummary(invoice, paidAt);

    const notification = await this.createNotification(
      companyId,
      invoiceId,
      recipients,
      summary,
    );

    if (!notification || !invoice.company.paymentNotificationEnabled) {
      return;
    }

    try {
      await this.sendPaymentEmail(invoice, recipients, paidAt);
      await this.prisma.paymentNotification.updateMany({
        where: { id: notification.id, companyId },
        data: {
          status: 'SENT',
          errorMessage: null,
          sentAt: new Date(),
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Erro desconhecido no envio';

      await this.prisma.paymentNotification.updateMany({
        where: { id: notification.id, companyId },
        data: {
          status: 'FAILED',
          errorMessage: message,
        },
      });

      this.logger.warn(
        `Falha ao enviar alerta de pagamento ${notification.id}: ${message}`,
      );
    }
  }

  async list(companyId: string): Promise<PaymentNotificationListResponse> {
    const [notifications, unreadCount] = await Promise.all([
      this.prisma.paymentNotification.findMany({
        where: { companyId },
        include: {
          invoice: {
            select: {
              originalAmount: true,
              dueDate: true,
              paidAt: true,
              billingType: true,
              studentName: true,
              studentEnrollment: true,
              studentGroup: true,
              debtor: {
                select: {
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.paymentNotification.count({
        where: { companyId, status: { not: 'READ' } },
      }),
    ]);

    return {
      data: notifications.map((notification) =>
        this.mapNotification(notification),
      ),
      unreadCount,
    };
  }

  async markAsRead(
    companyId: string,
    notificationId: string,
  ): Promise<PaymentNotificationListItem | null> {
    const readAt = new Date();
    const result = await this.prisma.paymentNotification.updateMany({
      where: { id: notificationId, companyId },
      data: { status: 'READ', readAt },
    });

    if (result.count === 0) {
      return null;
    }

    const notification = await this.prisma.paymentNotification.findFirst({
      where: { id: notificationId, companyId },
      include: {
        invoice: {
          select: {
            originalAmount: true,
            dueDate: true,
            paidAt: true,
            billingType: true,
            studentName: true,
            studentEnrollment: true,
            studentGroup: true,
            debtor: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
      },
    });

    return notification ? this.mapNotification(notification) : null;
  }

  private async createNotification(
    companyId: string,
    invoiceId: string,
    recipientEmails: string[],
    summary: Prisma.InputJsonObject,
  ): Promise<{ id: string } | null> {
    try {
      return await this.prisma.paymentNotification.create({
        data: {
          companyId,
          invoiceId,
          status: 'PENDING',
          recipientEmails,
          summary,
        },
        select: { id: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return null;
      }

      throw error;
    }
  }

  private async sendPaymentEmail(
    invoice: PaidInvoiceRecord,
    recipients: string[],
    paidAt: Date,
  ): Promise<void> {
    if (recipients.length === 0) {
      throw new Error('Nenhum destinatario configurado para alerta.');
    }

    if (!invoice.company.resendApiKeyEncrypted) {
      throw new Error('Resend API key nao configurada para esta empresa.');
    }

    const apiKey = this.crypto.decrypt(invoice.company.resendApiKeyEncrypted);
    const fromEmail =
      invoice.company.resendFromEmail ??
      this.configService.get<string>('RESEND_FROM_EMAIL') ??
      'cobranca@cobrapix.com';

    const response = await fetch(`${RESEND_API}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: recipients,
        subject: this.buildEmailSubject(invoice),
        html: this.buildPaymentEmailHtml(invoice, paidAt),
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Resend API: falha (${response.status}): ${body}`);
    }
  }

  private buildPaymentSummary(
    invoice: PaidInvoiceRecord,
    paidAt: Date,
  ): Prisma.InputJsonObject {
    return {
      invoiceId: invoice.id,
      debtorName: invoice.debtor.name,
      debtorEmail: invoice.debtor.email,
      amount: this.toMoney(invoice.originalAmount),
      billingType: invoice.billingType,
      dueDate: invoice.dueDate.toISOString(),
      paidAt: paidAt.toISOString(),
      studentName: invoice.studentName,
      studentEnrollment: invoice.studentEnrollment,
      studentGroup: invoice.studentGroup,
    };
  }

  private buildEmailSubject(invoice: PaidInvoiceRecord): string {
    const studentLabel = invoice.studentName
      ? ` - ${invoice.studentName}`
      : '';

    return `[CobraPix] Pagamento confirmado${studentLabel}`;
  }

  private buildPaymentEmailHtml(
    invoice: PaidInvoiceRecord,
    paidAt: Date,
  ): string {
    const educationRows = this.buildEducationRows(invoice);
    const amount = this.formatCurrency(this.toMoney(invoice.originalAmount));

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pagamento confirmado</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">
    <tr>
      <td style="padding:28px 32px;background:#047857;color:#fff">
        <h1 style="margin:0;font-size:20px;line-height:1.3">Pagamento confirmado</h1>
        <p style="margin:6px 0 0;font-size:13px;color:#d1fae5">${this.escapeHtml(invoice.company.corporateName)}</p>
      </td>
    </tr>
    <tr>
      <td style="padding:28px 32px">
        <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#475569">Uma baixa de pagamento foi registrada no CobraPix.</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f8fafc;border-radius:8px;overflow:hidden">
          ${this.buildDetailRow('Fatura', invoice.id)}
          ${this.buildDetailRow('Devedor', invoice.debtor.name)}
          ${this.buildDetailRow('Valor', amount)}
          ${this.buildDetailRow('Metodo', invoice.billingType)}
          ${this.buildDetailRow('Data da baixa', this.formatDateTime(paidAt))}
          ${educationRows}
        </table>
        <p style="margin:18px 0 0;font-size:12px;color:#64748b;line-height:1.5">Este aviso e operacional. Os dados educacionais aparecem somente quando foram informados na fatura.</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private buildEducationRows(invoice: PaidInvoiceRecord): string {
    const rows = [
      invoice.studentName
        ? this.buildDetailRow('Aluno', invoice.studentName)
        : null,
      invoice.studentEnrollment
        ? this.buildDetailRow('Matricula', invoice.studentEnrollment)
        : null,
      invoice.studentGroup
        ? this.buildDetailRow('Turma/Curso', invoice.studentGroup)
        : null,
    ].filter((row): row is string => Boolean(row));

    return rows.join('');
  }

  private buildDetailRow(label: string, value: string): string {
    return `<tr>
      <td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;width:38%;font-size:12px;font-weight:700;text-transform:uppercase;color:#64748b">${this.escapeHtml(label)}</td>
      <td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-size:14px;font-weight:600;color:#0f172a">${this.escapeHtml(value)}</td>
    </tr>`;
  }

  private mapNotification(
    notification: PaymentNotificationListRecord,
  ): PaymentNotificationListItem {
    return {
      id: notification.id,
      invoiceId: notification.invoiceId,
      status: notification.status,
      recipientEmails: notification.recipientEmails,
      errorMessage: notification.errorMessage,
      debtorName: notification.invoice.debtor.name,
      debtorEmail: notification.invoice.debtor.email,
      amount: this.toMoney(notification.invoice.originalAmount),
      billingType: notification.invoice.billingType,
      dueDate: notification.invoice.dueDate.toISOString(),
      paidAt: notification.invoice.paidAt?.toISOString() ?? null,
      studentName: notification.invoice.studentName,
      studentEnrollment: notification.invoice.studentEnrollment,
      studentGroup: notification.invoice.studentGroup,
      sentAt: notification.sentAt?.toISOString() ?? null,
      readAt: notification.readAt?.toISOString() ?? null,
      createdAt: notification.createdAt.toISOString(),
      summary: notification.summary,
    };
  }

  private resolveRecipients(
    configuredEmails: string[],
    fallbackEmail: string,
  ): string[] {
    const source = configuredEmails.length > 0 ? configuredEmails : [fallbackEmail];
    const emails = source
      .map((email) => email.trim().toLowerCase())
      .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));

    return Array.from(new Set(emails));
  }

  private toMoney(value: { toNumber(): number }): number {
    return Number(value.toNumber().toFixed(2));
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  }

  private formatDateTime(value: Date): string {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Sao_Paulo',
    }).format(value);
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
