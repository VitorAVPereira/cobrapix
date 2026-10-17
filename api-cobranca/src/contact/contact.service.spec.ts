import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type {
  ResendMailerService,
  SendResendEmailInput,
} from '../common/resend-mailer.service';
import { ContactService, QUOTE_REQUEST_RECEIVED } from './contact.service';
import type { QuoteRequestDto } from './dto/quote-request.dto';

describe('ContactService', () => {
  const env: Record<string, string | undefined> = {
    RESEND_API_KEY: 're_test',
    RESEND_FROM_EMAIL: 'Cifra+ <cobranca@example.com>',
    QUOTE_REQUEST_EMAIL: 'comercial@example.com',
  };
  let sendEmail: jest.Mock<Promise<{ id: string }>, [SendResendEmailInput]>;
  let service: ContactService;

  const dto = (overrides: Partial<QuoteRequestDto> = {}): QuoteRequestDto => ({
    name: '  Maria <b>Silva</b> ',
    email: 'Maria@Empresa.com.br',
    phone: '(11) 98888-7777',
    ...overrides,
  });

  const sentAt = (index: number): SendResendEmailInput => {
    const call = sendEmail.mock.calls[index];
    if (!call) throw new Error('E-mail não enviado.');
    return call[0];
  };

  beforeEach(() => {
    sendEmail = jest
      .fn<Promise<{ id: string }>, [SendResendEmailInput]>()
      .mockResolvedValue({ id: 'email-1' });
    const config = { get: (key: string) => env[key] } as ConfigService;
    service = new ContactService(config, {
      sendEmail,
    } as unknown as ResendMailerService);
  });

  it('envia o pedido ao e-mail configurado com os dados escapados', async () => {
    await expect(
      service.requestQuote(dto({ monthlyVolume: '200', averageTicket: '' })),
    ).resolves.toEqual({ message: QUOTE_REQUEST_RECEIVED });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const input = sentAt(0);
    expect(input.to).toEqual(['comercial@example.com']);
    expect(input.replyTo).toBe('maria@empresa.com.br');
    expect(input.html).toContain('Maria &lt;b&gt;Silva&lt;/b&gt;');
    expect(input.html).toContain('11988887777');
    expect(input.html).toContain(
      '<strong>Volume de cobranças por mês:</strong> 200',
    );
    expect(input.html).toContain(
      '<strong>Ticket médio:</strong> Não informado',
    );
    expect(input.idempotencyKey).toMatch(/^quote-request-[a-f0-9]{32}$/);
  });

  it('usa a mesma chave idempotente para o mesmo contato no mesmo dia', async () => {
    await service.requestQuote(dto());
    await service.requestQuote(dto({ phone: '11 98888 7777' }));

    expect(sentAt(0).idempotencyKey).toBe(sentAt(1).idempotencyKey);
  });

  it('responde normalmente sem enviar quando o campo oculto vem preenchido', async () => {
    await expect(
      service.requestQuote(dto({ website: 'http://spam.example' })),
    ).resolves.toEqual({ message: QUOTE_REQUEST_RECEIVED });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('recusa celular com quantidade de dígitos inválida', async () => {
    await expect(
      service.requestQuote(dto({ phone: '(11) 9888' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('fica indisponível sem e-mail de destino configurado', async () => {
    env.QUOTE_REQUEST_EMAIL = undefined;
    try {
      await expect(service.requestQuote(dto())).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(sendEmail).not.toHaveBeenCalled();
    } finally {
      env.QUOTE_REQUEST_EMAIL = 'comercial@example.com';
    }
  });

  it('fica indisponível quando o provedor de e-mail falha', async () => {
    sendEmail.mockRejectedValue(new Error('Resend API: timeout'));
    await expect(service.requestQuote(dto())).rejects.toMatchObject({
      response: { code: 'QUOTE_REQUEST_UNAVAILABLE' },
    });
  });
});
