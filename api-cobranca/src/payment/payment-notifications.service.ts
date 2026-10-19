import { Injectable, Logger } from '@nestjs/common';
import { PaymentNotificationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import {
  formatResendFromAddress,
  ResendMailerService,
} from '../common/resend-mailer.service';
import { resolvePeriodInstants } from '../billing/dashboard-period';
import { searchDigits } from '../common/search-digits';
import type { PaymentNotificationFilterDto } from './dto/payment-notification.dto';

const notificationInclude = {
  invoice: {
    select: {
      originalAmount: true,
      dueDate: true,
      paidAt: true,
      billingType: true,
      studentName: true,
      studentEnrollment: true,
      studentGroup: true,
      debtor: { select: { name: true, email: true, document: true } },
    },
  },
} satisfies Prisma.PaymentNotificationInclude;

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
      document: string | null;
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
  debtorDocument: string | null;
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
  /** Every unread notification of the company, whatever the filter. */
  unreadCount: number;
  total: number;
  page: number;
  pageSize: number;
  /** Unread notifications matching the filter: what "mark all" would change. */
  filteredUnread: number;
  /** Moment of the list; "mark all" covers only notifications created until then. */
  asOf: string;
}

export type MarkReadTarget =
  | { ids: string[] }
  | { filter: PaymentNotificationFilterDto; asOf: Date };

@Injectable()
export class PaymentNotificationsService {
  private readonly logger = new Logger(PaymentNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly resendMailer: ResendMailerService,
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

  async list(
    companyId: string,
    params: PaymentNotificationFilterDto & { page: number; pageSize: number },
    now = new Date(),
  ): Promise<PaymentNotificationListResponse> {
    const where = this.buildWhere(companyId, params, now);
    const [notifications, total, filteredUnread, unreadCount] =
      await Promise.all([
        this.prisma.paymentNotification.findMany({
          where,
          include: notificationInclude,
          // The id tie-breaker keeps pages stable when many rows share a time.
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (params.page - 1) * params.pageSize,
          take: params.pageSize,
        }),
        this.prisma.paymentNotification.count({ where }),
        this.prisma.paymentNotification.count({
          where: { AND: [where, { status: { not: 'READ' } }] },
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
      total,
      page: params.page,
      pageSize: params.pageSize,
      filteredUnread,
      asOf: now.toISOString(),
    };
  }

  /** Marks the selected rows, or every unread row of a filter, as read. */
  async markManyAsRead(
    companyId: string,
    target: MarkReadTarget,
  ): Promise<{ count: number }> {
    const scope: Prisma.PaymentNotificationWhereInput =
      'ids' in target
        ? { companyId, id: { in: target.ids } }
        : {
            AND: [
              this.buildWhere(companyId, target.filter, target.asOf),
              { createdAt: { lte: target.asOf } },
            ],
          };
    const { count } = await this.prisma.paymentNotification.updateMany({
      // Already read rows keep their original read time.
      where: { AND: [scope, { status: { not: 'READ' } }] },
      data: { status: 'READ', readAt: new Date() },
    });
    return { count };
  }

  private buildWhere(
    companyId: string,
    filter: PaymentNotificationFilterDto,
    now: Date,
  ): Prisma.PaymentNotificationWhereInput {
    const where: Prisma.PaymentNotificationWhereInput = { companyId };
    const invoice: Prisma.InvoiceWhereInput = {};

    if (filter.state === 'unread') where.status = { not: 'READ' };
    if (filter.state === 'read') where.status = 'READ';
    // Reading keeps the error, so a failed e-mail stays findable after it.
    if (filter.state === 'email_failed') where.errorMessage = { not: null };

    if (filter.billingType) {
      // BOLIX is a boleto for the company and its payers.
      invoice.billingType =
        filter.billingType === 'BOLETO'
          ? { in: ['BOLETO', 'BOLIX'] }
          : filter.billingType;
    }

    if (filter.period) {
      invoice.paidAt = resolvePeriodInstants(filter.period, now, filter);
    }

    const search = filter.search?.trim();
    if (search) {
      invoice.OR = [
        { debtor: { name: { contains: search, mode: 'insensitive' } } },
        { debtor: { document: { contains: searchDigits(search) } } },
        { debtor: { email: { contains: search, mode: 'insensitive' } } },
        { studentName: { contains: search, mode: 'insensitive' } },
        { studentEnrollment: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (Object.keys(invoice).length > 0) where.invoice = invoice;
    return where;
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
      include: notificationInclude,
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

    const apiKey = this.config.getOrThrow<string>('RESEND_API_KEY');
    const fromEmail = formatResendFromAddress(
      'CifraMais',
      this.config.getOrThrow<string>('RESEND_FROM_EMAIL'),
    );

    await this.resendMailer.sendEmail({
      apiKey,
      from: fromEmail,
      replyTo: this.config.getOrThrow<string>('RESEND_REPLY_TO'),
      idempotencyKey: 'payment-confirmed-' + invoice.id,
      to: recipients,
      subject: this.buildEmailSubject(invoice),
      html: this.buildPaymentEmailHtml(invoice, paidAt),
    });
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
    const studentLabel = invoice.studentName ? ` - ${invoice.studentName}` : '';

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
      debtorDocument: notification.invoice.debtor.document,
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
    const source =
      configuredEmails.length > 0 ? configuredEmails : [fallbackEmail];
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
