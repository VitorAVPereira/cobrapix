import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { ResendMailerService } from '../common/resend-mailer.service';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateSendPreparerService } from '../templates/template-send-preparer.service';
import type { TemplatePurpose } from '../templates/template-contracts';
import { OnboardingNotifications } from './onboarding-notifications';

@Injectable()
export class CentralOnboardingNotifications extends OnboardingNotifications {
  constructor(
    private readonly config: ConfigService,
    private readonly whatsapp: WhatsappService,
    private readonly mailer: ResendMailerService,
    private readonly prisma: PrismaService,
    private readonly templateSender: TemplateSendPreparerService,
  ) {
    super();
  }
  /** Name and company come from the validated activation, not from these arguments. */
  async sendNotice(companyId: string, phone: string): Promise<string> {
    // Workflow retries reuse the day's pending/accepted/uncertain intent, so nothing is sent twice;
    // a definitively rejected attempt frees the next generation of the same notice.
    return this.send(
      companyId,
      'ACTIVATION_NOTICE',
      `efi-onboarding-notice:${companyId}:${this.day()}:${createHash('sha256').update(phone).digest('hex').slice(0, 16)}`,
    );
  }
  async sendReminder(companyId: string): Promise<string> {
    // The 24h and 72h reminders fall on different days.
    return this.send(
      companyId,
      'ACTIVATION_REMINDER',
      `efi-onboarding-reminder:${companyId}:${this.day()}`,
    );
  }
  /**
   * Activation notices use their own purpose defaults and the validated activation data
   * (representative name and phone); a collection default is never reused for them.
   */
  private async send(
    companyId: string,
    purpose: TemplatePurpose,
    logicalKey: string,
  ): Promise<string> {
    const activation = await this.prisma.efiOnboarding.findUnique({
      where: { companyId },
      select: { id: true },
    });
    if (!activation)
      throw new ServiceUnavailableException('Canal central indisponível.');
    const prepared = await this.templateSender.prepare(
      {
        logicalKey,
        origin: 'ACTIVATION',
        context: { companyId, activationId: activation.id },
        selection: { mode: 'DEFAULT', purpose },
      },
      { renewAfterRejection: true },
    );
    if (prepared.status === 'BLOCKED')
      throw new ServiceUnavailableException({
        code: 'TEMPLATE_HELD',
        message: 'Aviso retido até a revisão do template pelo administrador.',
      });
    const response = await this.whatsapp.dispatchIntent(prepared.intentId);
    return response.messageId;
  }
  async alert(companyId: string, code: string): Promise<void> {
    const safeCode = /^[A-Z0-9_]{1,80}$/.test(code)
      ? code
      : 'EFI_REQUIRES_ATTENTION';
    const safeCompany = companyId.replace(/[^a-zA-Z0-9-]/g, '');
    await this.mailer.sendEmail({
      apiKey: this.required('RESEND_API_KEY'),
      from: this.required('RESEND_FROM_EMAIL'),
      replyTo: this.required('RESEND_REPLY_TO'),
      to: [this.required('PLATFORM_ALERT_EMAIL')],
      subject: 'Ativação financeira requer atenção',
      html: `<p>Empresa: ${safeCompany}</p><p>Código: ${safeCode}</p><p>Consulte o painel administrativo da CifraMais.</p>`,
      idempotencyKey: `efi-alert-${safeCompany}-${safeCode}-${new Date().toISOString().slice(0, 10)}`,
    });
  }
  private day(): string {
    return new Date().toISOString().slice(0, 10);
  }
  private required(name: string): string {
    const value = this.config.get<string>(name)?.trim();
    if (!value)
      throw new ServiceUnavailableException('Canal central indisponível.');
    return value;
  }
}
