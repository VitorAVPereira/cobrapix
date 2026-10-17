import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { ResendMailerService } from '../common/resend-mailer.service';
import type { QuoteRequestDto } from './dto/quote-request.dto';

export const QUOTE_REQUEST_RECEIVED =
  'Recebemos seu pedido. Nossa equipe entra em contato em breve.';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly mailer: ResendMailerService,
  ) {}

  async requestQuote(dto: QuoteRequestDto): Promise<{ message: string }> {
    // Bots fill the hidden field; answer as usual so they learn nothing.
    if (dto.website?.trim()) return { message: QUOTE_REQUEST_RECEIVED };

    const phoneDigits = dto.phone.replace(/\D/g, '');
    if (phoneDigits.length < 10 || phoneDigits.length > 13)
      throw new BadRequestException({
        code: 'INVALID_PHONE',
        message: 'Celular inválido.',
      });

    const lead = {
      name: dto.name.trim(),
      email: dto.email.trim().toLowerCase(),
      phone: phoneDigits,
      monthlyVolume: dto.monthlyVolume?.trim() || 'Não informado',
      averageTicket: dto.averageTicket?.trim() || 'Não informado',
    };

    const apiKey = this.required('RESEND_API_KEY');
    const from = this.required('RESEND_FROM_EMAIL');
    const to = this.required('QUOTE_REQUEST_EMAIL');

    try {
      await this.mailer.sendEmail({
        apiKey,
        from,
        to: [to],
        replyTo: lead.email,
        subject: `Pedido de orçamento: ${lead.name.replace(/[\r\n]+/g, ' ')}`,
        html: [
          '<p>Novo pedido de orçamento pela página de apresentação.</p>',
          `<p><strong>Nome:</strong> ${escapeHtml(lead.name)}</p>`,
          `<p><strong>E-mail:</strong> ${escapeHtml(lead.email)}</p>`,
          `<p><strong>Celular:</strong> ${escapeHtml(lead.phone)}</p>`,
          `<p><strong>Volume de cobranças por mês:</strong> ${escapeHtml(lead.monthlyVolume)}</p>`,
          `<p><strong>Ticket médio:</strong> ${escapeHtml(lead.averageTicket)}</p>`,
        ].join(''),
        // A double click or a retry on the same day sends one e-mail only.
        idempotencyKey: `quote-request-${createHash('sha256')
          .update(
            `${lead.email}|${lead.phone}|${new Date().toISOString().slice(0, 10)}`,
          )
          .digest('hex')
          .slice(0, 32)}`,
      });
    } catch (error: unknown) {
      this.logger.error(
        `Falha ao enviar pedido de orçamento: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      );
      throw this.unavailable();
    }

    return { message: QUOTE_REQUEST_RECEIVED };
  }

  private required(name: string): string {
    const value = this.config.get<string>(name)?.trim();
    if (!value) throw this.unavailable();
    return value;
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'QUOTE_REQUEST_UNAVAILABLE',
      message:
        'Não foi possível enviar seu pedido agora. Tente de novo ou fale com a gente pelo WhatsApp.',
    });
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
