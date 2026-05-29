import { Resend } from 'resend';
import { ResendMailerService } from './resend-mailer.service';

jest.mock('resend', () => ({
  Resend: jest.fn(),
}));

describe('ResendMailerService', () => {
  const resendClass = Resend as jest.MockedClass<typeof Resend>;

  beforeEach(() => {
    resendClass.mockReset();
  });

  it('envia email usando o SDK oficial do Resend', async () => {
    const send = jest.fn().mockResolvedValue({
      data: { id: 'email-123' },
      error: null,
      headers: null,
    });
    resendClass.mockImplementation(
      () => ({ emails: { send } }) as unknown as Resend,
    );

    const service = new ResendMailerService();
    const result = await service.sendEmail({
      apiKey: 're_cliente_123',
      from: 'Escola Teste <cobranca@escolateste.com.br>',
      to: ['responsavel@familia.com'],
      subject: '[Escola Teste] Cobranca pendente',
      html: '<p>Cobranca pendente</p>',
    });

    expect(result).toEqual({ id: 'email-123' });
    expect(resendClass).toHaveBeenCalledWith('re_cliente_123');
    expect(send).toHaveBeenCalledWith({
      from: 'Escola Teste <cobranca@escolateste.com.br>',
      to: ['responsavel@familia.com'],
      subject: '[Escola Teste] Cobranca pendente',
      html: '<p>Cobranca pendente</p>',
    });
  });

  it('propaga erro retornado pelo SDK do Resend', async () => {
    const send = jest.fn().mockResolvedValue({
      data: null,
      error: {
        name: 'invalid_api_key',
        message: 'API key is invalid',
        statusCode: 401,
      },
      headers: null,
    });
    resendClass.mockImplementation(
      () => ({ emails: { send } }) as unknown as Resend,
    );

    const service = new ResendMailerService();

    await expect(
      service.sendEmail({
        apiKey: 're_cliente_123',
        from: 'Escola Teste <cobranca@escolateste.com.br>',
        to: ['responsavel@familia.com'],
        subject: '[Escola Teste] Cobranca pendente',
        html: '<p>Cobranca pendente</p>',
      }),
    ).rejects.toThrow(
      'Resend API: falha (401 invalid_api_key): API key is invalid',
    );
  });

  it('cria, publica, atualiza e remove templates usando SDK oficial do Resend', async () => {
    const create = jest.fn().mockResolvedValue({
      data: { id: 'resend-template-1', object: 'template' },
      error: null,
    });
    const publish = jest.fn().mockResolvedValue({
      data: { id: 'resend-template-1', object: 'template' },
      error: null,
    });
    const update = jest.fn().mockResolvedValue({
      data: { id: 'resend-template-1', object: 'template' },
      error: null,
    });
    const remove = jest.fn().mockResolvedValue({
      data: {
        id: 'resend-template-1',
        object: 'template',
        deleted: true,
      },
      error: null,
    });
    const get = jest.fn().mockResolvedValue({
      data: {
        id: 'resend-template-1',
        name: 'Vencimento hoje',
        alias: 'cobrapix_vencimento_hoje',
        status: 'published',
        published_at: '2026-05-27T10:00:00.000Z',
        created_at: '2026-05-27T09:00:00.000Z',
        updated_at: '2026-05-27T10:00:00.000Z',
        object: 'template',
      },
      error: null,
    });
    const list = jest.fn().mockResolvedValue({
      data: {
        object: 'list',
        has_more: false,
        data: [
          {
            id: 'resend-template-1',
            name: 'Vencimento hoje',
            alias: 'cobrapix_vencimento_hoje',
            status: 'published',
            published_at: '2026-05-27T10:00:00.000Z',
            created_at: '2026-05-27T09:00:00.000Z',
            updated_at: '2026-05-27T10:00:00.000Z',
          },
        ],
      },
      error: null,
    });
    resendClass.mockImplementation(
      () =>
        ({
          templates: { create, publish, update, remove, get, list },
        }) as unknown as Resend,
    );

    const service = new ResendMailerService();
    const payload = {
      apiKey: 're_cliente_123',
      name: 'Vencimento hoje',
      alias: 'cobrapix_vencimento_hoje',
      from: 'Escola Teste <cobranca@escolateste.com.br>',
      subject: '{{{NOME_EMPRESA}}}: vencimento hoje',
      html: '<p>Ola {{{NOME_DEVEDOR}}}</p>',
      text: 'Ola {{{NOME_DEVEDOR}}}',
      variables: [
        {
          key: 'NOME_DEVEDOR',
          type: 'string' as const,
          fallbackValue: 'Cliente',
        },
      ],
    };

    await expect(service.createTemplate(payload)).resolves.toEqual({
      id: 'resend-template-1',
    });
    await expect(
      service.publishTemplate({
        apiKey: 're_cliente_123',
        idOrAlias: 'resend-template-1',
      }),
    ).resolves.toEqual({ id: 'resend-template-1' });
    await expect(
      service.updateTemplate({
        ...payload,
        idOrAlias: 'resend-template-1',
      }),
    ).resolves.toEqual({ id: 'resend-template-1' });
    await expect(
      service.deleteTemplate({
        apiKey: 're_cliente_123',
        idOrAlias: 'resend-template-1',
      }),
    ).resolves.toEqual({ id: 'resend-template-1', deleted: true });
    await expect(
      service.getTemplate({
        apiKey: 're_cliente_123',
        idOrAlias: 'resend-template-1',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'resend-template-1',
        alias: 'cobrapix_vencimento_hoje',
        status: 'published',
      }),
    );
    await expect(
      service.listTemplates({
        apiKey: 're_cliente_123',
        limit: 20,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'resend-template-1',
        alias: 'cobrapix_vencimento_hoje',
        status: 'published',
      }),
    ]);

    expect(create).toHaveBeenCalledWith({
      name: payload.name,
      alias: payload.alias,
      from: payload.from,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      variables: payload.variables,
    });
    expect(update).toHaveBeenCalledWith('resend-template-1', {
      name: payload.name,
      alias: payload.alias,
      from: payload.from,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      variables: payload.variables,
    });
    expect(publish).toHaveBeenCalledWith('resend-template-1');
    expect(remove).toHaveBeenCalledWith('resend-template-1');
    expect(get).toHaveBeenCalledWith('resend-template-1');
    expect(list).toHaveBeenCalledWith({ limit: 20 });
  });

  it('valida webhook usando o verificador oficial do SDK do Resend', () => {
    const payload = {
      type: 'email.delivered',
      created_at: '2026-05-27T10:00:00.000Z',
      data: {
        email_id: 'email-123',
        created_at: '2026-05-27T10:00:00.000Z',
        from: 'Escola Teste <cobranca@escolateste.com.br>',
        to: ['responsavel@familia.com'],
        subject: 'Cobranca pendente',
      },
    };
    const verify = jest.fn().mockReturnValue(payload);
    resendClass.mockImplementation(
      () => ({ webhooks: { verify } }) as unknown as Resend,
    );

    const service = new ResendMailerService();
    const verifier = service as unknown as {
      verifyWebhookEvent?: (input: {
        payload: string;
        headers: {
          id?: string;
          timestamp?: string;
          signature?: string;
        };
        webhookSecret: string;
      }) => unknown;
    };

    expect(verifier.verifyWebhookEvent).toEqual(expect.any(Function));
    const result = verifier.verifyWebhookEvent?.({
      payload: JSON.stringify(payload),
      headers: {
        id: 'msg_123',
        timestamp: '1780000000',
        signature: 'v1,signature',
      },
      webhookSecret: 'whsec_test',
    });

    expect(result).toEqual(payload);
    expect(resendClass).toHaveBeenCalledWith();
    expect(verify).toHaveBeenCalledWith({
      payload: JSON.stringify(payload),
      headers: {
        id: 'msg_123',
        timestamp: '1780000000',
        signature: 'v1,signature',
      },
      webhookSecret: 'whsec_test',
    });
  });
});
