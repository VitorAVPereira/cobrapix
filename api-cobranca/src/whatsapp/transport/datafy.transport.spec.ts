import { DatafyRateLimitService } from './datafy-rate-limit.service';
const testQuota = {
  acquire: jest.fn().mockResolvedValue(undefined),
} as unknown as DatafyRateLimitService;
import { ConfigService } from '@nestjs/config';
import { DatafyTransport } from './datafy.transport';
import { createWhatsappTransport } from './whatsapp-transport.module';

const configValues = {
  META_PHONE_NUMBER_ID: '1234567890',
  META_BUSINESS_ACCOUNT_ID: '9876543210',
  DATAFY_API_TOKEN: 'sk_live_test_only',
};
const template = {
  name: 'aviso',
  language: 'pt_BR',
  category: 'UTILITY',
  components: [{ type: 'BODY', text: 'Sua fatura esta disponivel.' }],
};
function reply(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe('Datafy transport contract', () => {
  let transport: DatafyTransport;
  let http: jest.SpyInstance<
    ReturnType<typeof fetch>,
    Parameters<typeof fetch>
  >;
  beforeEach(() => {
    transport = new DatafyTransport(new ConfigService(configValues), testQuota);
    http = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());

  it('envia template com contrato Meta e devolve apenas aceitacao e ID', async () => {
    http.mockResolvedValue(
      reply({
        messages: [{ id: 'wamid.1', message_status: 'accepted' }],
        access_token: 'not-to-return',
      }),
    );
    await expect(
      transport.sendTemplate({
        to: '5511999999999',
        name: 'aviso',
        language: 'pt_BR',
        components: [],
      }),
    ).resolves.toEqual({
      accepted: true,
      messageId: 'wamid.1',
      status: 'accepted',
    });
    expect(http).toHaveBeenCalledWith(
      'https://cloud.datafyapi.com.br/v1/1234567890/messages',
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '5511999999999',
          type: 'template',
          template: {
            name: 'aviso',
            language: { code: 'pt_BR' },
            components: [],
          },
        }),
        headers: {
          Authorization: 'Bearer sk_live_test_only',
          'Content-Type': 'application/json',
        },
      }),
    );
  });

  it('cria template no WABA configurado', async () => {
    http.mockResolvedValue(
      reply({ id: 'template-1', status: 'PENDING', category: 'UTILITY' }),
    );
    await expect(transport.createTemplate(template)).resolves.toEqual({
      id: 'template-1',
      status: 'PENDING',
      category: 'UTILITY',
    });
    expect(http).toHaveBeenCalledWith(
      'https://cloud.datafyapi.com.br/v1/9876543210/message_templates',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(template),
      }),
    );
  });

  it('valida os IDs de /me fora de /v1 e nao retorna cliente_id', async () => {
    http.mockResolvedValue(
      reply({
        cliente_id: 'datafy-account',
        phone_number_id: '1234567890',
        waba_id: '9876543210',
        business_id: '777',
      }),
    );
    await expect(transport.getChannelInfo()).resolves.toEqual({
      phoneNumberId: '1234567890',
      businessAccountId: '9876543210',
    });
    expect(http).toHaveBeenCalledWith(
      'https://cloud.datafyapi.com.br/me',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it.each([
    { phone_number_id: '999', waba_id: '9876543210' },
    { phone_number_id: '1234567890', waba_id: '999' },
  ])('recusa token associado a outro numero ou WABA', async (body) => {
    http.mockResolvedValue(reply(body));
    await expect(transport.getChannelInfo()).rejects.toMatchObject({
      kind: 'CONFIGURATION',
      outcome: 'NOT_SENT',
    });
  });

  it('reconstroi paginacao com cursor e nunca segue next para outro host', async () => {
    http.mockResolvedValueOnce(
      reply({
        data: [{ name: 'aviso', language: 'pt_BR', status: 'APPROVED' }],
        paging: {
          next: 'https://attacker.example/steal?access_token=secret',
          cursors: { after: 'abc+123' },
        },
      }),
    );
    http.mockResolvedValueOnce(reply({ data: [] }));
    const page = await transport.listTemplates();
    expect(page.after).toBe('abc+123');
    expect(JSON.stringify(page)).not.toContain('attacker');
    await transport.listTemplates(page.after);
    expect(http.mock.calls[1]?.[0]).toBe(
      'https://cloud.datafyapi.com.br/v1/9876543210/message_templates?fields=id,name,language,status,rejected_reason,category,components,quality_score&limit=100&after=abc%2B123',
    );
  });

  it.each(['../../me', 'https://attacker.example', '1?access_token=oops'])(
    'recusa ID configurado que alteraria host ou rota: %s',
    async (id: string) => {
      const invalid = new DatafyTransport(
        new ConfigService({ ...configValues, META_PHONE_NUMBER_ID: id }),
        testQuota,
      );
      await expect(
        invalid.sendText({ to: '5511999999999', text: 'Teste' }),
      ).rejects.toMatchObject({ kind: 'CONFIGURATION' });
      expect(http).not.toHaveBeenCalled();
    },
  );

  it('recusa redirecionamento sem segunda chamada e sem revelar Location', async () => {
    http.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://attacker.example/secret' },
      }),
    );
    await expect(
      transport.sendText({ to: '5511999999999', text: 'Teste' }),
    ).rejects.toMatchObject({ outcome: 'UNCERTAIN' });
    expect(http).toHaveBeenCalledTimes(1);
    expect(http.mock.calls[0]?.[1]?.redirect).toBe('error');
  });

  it.each([401, 402, 403])(
    'normaliza erro administrativo %i e omite segredos',
    async (status: number) => {
      http.mockResolvedValue(
        reply(
          {
            statusCode: status,
            message: 'sk_live_test_only phone 5511999999999',
          },
          status,
        ),
      );
      try {
        await transport.getChannelInfo();
        throw new Error('expected error');
      } catch (error: unknown) {
        expect(error).toMatchObject({
          kind: 'CONFIGURATION',
          providerStatus: status,
          outcome: 'NOT_SENT',
        });
        expect(String(error)).not.toContain('sk_live_test_only');
        expect(String(error)).not.toContain('5511999999999');
      }
    },
  );

  it('normaliza 429 com espera sem repetir o POST', async () => {
    http.mockResolvedValue(
      reply({ statusCode: 429, message: 'Tente novamente em 12s.' }, 429),
    );
    await expect(
      transport.sendText({ to: '5511999999999', text: 'Teste' }),
    ).rejects.toMatchObject({
      kind: 'RATE_LIMIT',
      outcome: 'REJECTED',
      retryAfterSeconds: 12,
    });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('normaliza erro Meta repassado pelo Datafy sem repassar texto bruto', async () => {
    http.mockResolvedValue(
      reply(
        {
          error: {
            code: 131047,
            message: 'sensitive body sk_live_test_only',
            fbtrace_id: 'TRACE_1',
          },
        },
        400,
      ),
    );
    await expect(
      transport.sendText({ to: '5511999999999', text: 'Teste' }),
    ).rejects.toMatchObject({
      kind: 'REJECTED',
      outcome: 'REJECTED',
      providerCode: 131047,
    });
  });

  it('nao expoe um segredo devolvido ate em campo de diagnostico do provedor', async () => {
    http.mockResolvedValue(
      reply(
        {
          error: {
            code: 100,
            message: 'sk_live_test_only',
            fbtrace_id: 'sk_live_test_only',
          },
        },
        400,
      ),
    );
    try {
      await transport.createTemplate(template);
      throw new Error('expected rejection');
    } catch (error: unknown) {
      expect(error).toMatchObject({ providerCode: 100 });
      expect(String(error)).not.toContain('sk_live_test_only');
    }
  });

  it.each(['timeout', 'invalid-response', 'server-error'])(
    'marca envio como incerto em %s sem retry',
    async (scenario: string) => {
      if (scenario === 'timeout')
        http.mockRejectedValue(new Error('sk_live_test_only timeout'));
      else
        http.mockResolvedValue(
          scenario === 'server-error'
            ? reply({}, 502)
            : reply({ messages: [] }),
        );
      await expect(
        transport.sendText({ to: '5511999999999', text: 'Teste' }),
      ).rejects.toMatchObject({ kind: 'UNCERTAIN', outcome: 'UNCERTAIN' });
      expect(http).toHaveBeenCalledTimes(1);
    },
  );

  it('baixa bytes fora de /v1 sem devolver URL ou headers privados', async () => {
    http.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'Content-Type': 'image/png', 'x-secret': 'never-expose' },
      }),
    );
    const media = await transport.downloadMedia('123456');
    expect(media).toEqual({
      bytes: Buffer.from([1, 2, 3]),
      contentType: 'image/png',
    });
    expect(http).toHaveBeenCalledWith(
      'https://cloud.datafyapi.com.br/media/123456/download',
      expect.objectContaining({ method: 'GET', redirect: 'error' }),
    );
  });

  it('limita tamanho de download antes de acumular o arquivo', async () => {
    http.mockResolvedValue(
      new Response('12345', { headers: { 'Content-Length': '999999999' } }),
    );
    await expect(transport.downloadMedia('123')).rejects.toMatchObject({
      kind: 'REJECTED',
    });
  });
});

describe('transporte unico', () => {
  it('sempre cria Datafy, mesmo com variavel antiga de transporte', () => {
    const transport = createWhatsappTransport(
      new ConfigService({ ...configValues, WHATSAPP_TRANSPORT: 'META_DIRECT' }),
      testQuota,
    );
    expect(transport).toBeInstanceOf(DatafyTransport);
    expect(transport.kind).toBe('DATAFY');
  });
});
