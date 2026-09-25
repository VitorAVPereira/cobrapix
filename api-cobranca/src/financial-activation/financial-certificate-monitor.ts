import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ResendMailerService } from '../common/resend-mailer.service';

const DAY_MS = 86400_000;
const AUDIT_RETENTION_MS = 5 * 365.25 * DAY_MS;

// Manually activated accounts have no automatic renewal (that exists only
// through the opening API). The platform team is warned at 30, 15 and 7 days
// and on expiry, once per certificate and threshold, to upload a new one.
@Injectable()
export class FinancialCertificateMonitor {
  private readonly logger = new Logger(FinancialCertificateMonitor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mailer: ResendMailerService,
  ) {}

  @Cron('0 40 7 * * *')
  async checkJob(): Promise<void> {
    try {
      await this.check();
    } catch {
      this.logger.error('FINANCIAL_CERTIFICATE_MONITOR_FAILED');
    }
  }

  async check(now = new Date()): Promise<number> {
    const credentials = await this.prisma.efiCredentialVersion.findMany({
      where: {
        status: 'ACTIVE',
        certificateExpiresAt: { lte: new Date(now.getTime() + 30 * DAY_MS) },
        identity: {
          ownership: 'COMPANY',
          financialProfiles: {
            some: { status: 'ACTIVE', origin: 'MANUAL_ADMIN' },
          },
        },
      },
      select: {
        id: true,
        certificateExpiresAt: true,
        identity: { select: { companyId: true } },
      },
      take: 500,
    });
    let sent = 0;
    for (const credential of credentials) {
      const companyId = credential.identity.companyId;
      if (!companyId) continue;
      const days = Math.ceil(
        (credential.certificateExpiresAt.getTime() - now.getTime()) / DAY_MS,
      );
      const action =
        days <= 0
          ? 'FINANCIAL_CERTIFICATE_EXPIRED'
          : `FINANCIAL_CERTIFICATE_EXPIRES_${days <= 7 ? 7 : days <= 15 ? 15 : 30}_DAYS`;
      const already = await this.prisma.auditLog.findFirst({
        where: {
          entityType: 'EfiCredentialVersion',
          entityId: credential.id,
          action,
        },
        select: { id: true },
      });
      if (already) continue;
      try {
        await this.alert(companyId, action);
      } catch {
        // Not recorded: the next run tries again.
        this.logger.error('FINANCIAL_CERTIFICATE_ALERT_FAILED');
        continue;
      }
      await this.prisma.auditLog.create({
        data: {
          companyId,
          entityType: 'EfiCredentialVersion',
          entityId: credential.id,
          action,
          changes: {
            certificateExpiresAt: credential.certificateExpiresAt.toISOString(),
          },
          retentionExpiresAt: new Date(now.getTime() + AUDIT_RETENTION_MS),
        },
      });
      sent++;
    }
    return sent;
  }

  private async alert(companyId: string, code: string): Promise<void> {
    const required = (name: string): string => {
      const value = this.config.get<string>(name)?.trim();
      if (!value) throw new Error('ALERT_CHANNEL_UNAVAILABLE');
      return value;
    };
    const safeCompany = companyId.replace(/[^a-zA-Z0-9-]/g, '');
    await this.mailer.sendEmail({
      apiKey: required('RESEND_API_KEY'),
      from: required('RESEND_FROM_EMAIL'),
      replyTo: required('RESEND_REPLY_TO'),
      to: [required('PLATFORM_ALERT_EMAIL')],
      subject: 'Certificado Efí de cliente próximo do vencimento',
      html: `<p>Empresa: ${safeCompany}</p><p>Código: ${code}</p><p>Envie o novo certificado em Ativação financeira no painel administrativo.</p>`,
      idempotencyKey: `financial-certificate-${safeCompany}-${code}-${now()}`,
    });
  }
}

function now(): string {
  return new Date().toISOString().slice(0, 10);
}
