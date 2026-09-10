import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { ResendMailerService } from '../common/resend-mailer.service';
import { OnboardingNotifications } from './onboarding-notifications';

@Injectable()
export class CentralOnboardingNotifications extends OnboardingNotifications {
  constructor(
    private readonly config: ConfigService,
    private readonly whatsapp: WhatsappService,
    private readonly mailer: ResendMailerService,
  ) {
    super();
  }
  async sendNotice(
    companyId: string,
    phone: string,
    representative: string,
    companyName: string,
  ): Promise<string> {
    const response = await this.whatsapp.sendTemplateMessage({
      companyId,
      phoneNumber: phone,
      templateName: this.required('EFI_ONBOARDING_NOTICE_TEMPLATE'),
      languageCode: this.config.get<string>('META_DEFAULT_LANGUAGE') ?? 'pt_BR',
      bodyParameters: [representative, companyName],
      content: 'Aviso de ativação financeira via CifraMais',
    });
    return response.messageId;
  }
  async sendReminder(
    companyId: string,
    phone: string,
    companyName: string,
  ): Promise<string> {
    const response = await this.whatsapp.sendTemplateMessage({
      companyId,
      phoneNumber: phone,
      templateName: this.required('EFI_ONBOARDING_REMINDER_TEMPLATE'),
      languageCode: this.config.get<string>('META_DEFAULT_LANGUAGE') ?? 'pt_BR',
      bodyParameters: [companyName],
      content: 'Lembrete de ativação financeira via CifraMais',
    });
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
  private required(name: string): string {
    const value = this.config.get<string>(name)?.trim();
    if (!value)
      throw new ServiceUnavailableException('Canal central indisponível.');
    return value;
  }
}
