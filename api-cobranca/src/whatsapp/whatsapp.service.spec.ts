import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsappService } from './whatsapp.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { PrismaService } from '../prisma/prisma.service';

interface PrismaMock {
  company: {
    findFirst: jest.Mock;
  };
  messageTemplate: {
    updateMany: jest.Mock;
  };
}

function createPrismaMock(): PrismaMock {
  return {
    company: {
      findFirst: jest.fn().mockResolvedValue({
        metaBusinessAccountId: '123456789',
        metaAccessTokenEncrypted: 'encrypted-token',
      }),
    },
    messageTemplate: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

function createService(prisma: PrismaMock): WhatsappService {
  return new WhatsappService(
    {
      get: jest.fn((_key: string, fallback?: string) => fallback),
    } as unknown as ConfigService,
    prisma as unknown as PrismaService,
    {
      decrypt: jest.fn().mockReturnValue('plain-token'),
    } as unknown as PaymentCryptoService,
  );
}

describe('WhatsappService createOfficialTemplate', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('recusa template oficial com variavel isolada no final da mensagem', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    const fetchMock = jest.fn();
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    await expect(
      service.createOfficialTemplate({
        companyId: 'company-1',
        template: {
          id: 'template-1',
          slug: 'pre-vencimento',
          content:
            'Ola, {{nome_devedor}}. Forma de pagamento: {{metodo_pagamento}}\n {{pix_copia_e_cola}}',
          metaTemplateName: 'cobrapix_pre_vencimento',
          metaLanguage: 'pt_BR',
          category: 'UTILITY',
        },
      }),
    ).rejects.toMatchObject({
      response:
        'A mensagem oficial da Meta nao pode comecar, terminar ou ter uma linha composta apenas por variavel. Adicione texto fixo antes e depois de cada {{variavel}}.',
      status: HttpStatus.BAD_REQUEST,
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retorna detalhes da Graph API quando a Meta rejeita o template', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: '(#100) Invalid parameter',
            error_data: {
              details:
                'For component BODY, template body cannot end with a parameter.',
            },
            error_subcode: 2494073,
            fbtrace_id: 'A_TEST_TRACE',
          },
        }),
        { status: 400 },
      ),
    );

    let exception: unknown;
    try {
      await service.createOfficialTemplate({
        companyId: 'company-1',
        template: {
          id: 'template-1',
          slug: 'pre-vencimento',
          content:
            'Ola, {{nome_devedor}}. Sua cobranca de {{valor}} vence amanha.',
          metaTemplateName: 'cobrapix_pre_vencimento',
          metaLanguage: 'pt_BR',
          category: 'UTILITY',
        },
      });
    } catch (error) {
      exception = error;
    }

    expect(exception).toBeInstanceOf(HttpException);
    const httpException = exception as HttpException;
    expect(httpException.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(httpException.message).toContain('Invalid parameter');
    expect(httpException.message).toContain(
      'template body cannot end with a parameter',
    );
    expect(httpException.message).toContain('2494073');
    expect(httpException.message).toContain('A_TEST_TRACE');
  });

  it('monta componentes BODY, FOOTER e BUTTONS para template oficial', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'meta-template-1',
          status: 'PENDING',
        }),
        { status: 200 },
      ),
    );
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    await service.createOfficialTemplate({
      companyId: 'company-1',
      template: {
        id: 'template-1',
        slug: 'vencimento-hoje',
        content: 'Ola, {{nome_devedor}}. Sua cobranca de {{valor}} vence hoje.',
        footerText: 'Mensagem automatica da {{nome_empresa}}.',
        paymentButtonEnabled: true,
        paymentButtonLabel: 'Abrir pagamento',
        copyCodeButtonEnabled: false,
        copyCodeSource: 'AUTO',
        metaTemplateName: 'cobrapix_vencimento_hoje',
        metaLanguage: 'pt_BR',
        category: 'UTILITY',
      },
    });

    const fetchBody = JSON.parse(
      fetchMock.mock.calls[0]?.[1]?.body as string,
    ) as {
      components: Array<{
        type: string;
        text?: string;
        buttons?: Array<{
          type: string;
          text: string;
          url?: string;
          example?: string[];
        }>;
      }>;
    };

    expect(fetchBody.components).toEqual([
      expect.objectContaining({
        type: 'BODY',
        text: 'Ola, {{1}}. Sua cobranca de {{2}} vence hoje.',
      }),
      expect.objectContaining({
        type: 'FOOTER',
        text: 'Mensagem automatica da Empresa Teste MVP.',
      }),
      expect.objectContaining({
        type: 'BUTTONS',
        buttons: [
          expect.objectContaining({
            type: 'URL',
            text: 'Abrir pagamento',
            url: 'http://localhost:3000/pagar/{{1}}',
            example: ['http://localhost:3000/pagar/exemplo-token'],
          }),
        ],
      }),
    ]);
  });

  it('bloqueia COPY_CODE longo antes de chamar a Meta', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'meta-template-1',
          status: 'PENDING',
        }),
        { status: 200 },
      ),
    );
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    await expect(
      service.createOfficialTemplate({
        companyId: 'company-1',
        template: {
          id: 'template-1',
          slug: 'vencimento-hoje',
          content:
            'Ola, {{nome_devedor}}. Sua cobranca de {{valor}} vence hoje.',
          footerText: '',
          paymentButtonEnabled: false,
          paymentButtonLabel: 'Abrir pagamento',
          copyCodeButtonEnabled: true,
          copyCodeSource: 'PIX_COPY_PASTE',
          metaTemplateName: 'cobrapix_vencimento_hoje',
          metaLanguage: 'pt_BR',
          category: 'UTILITY',
        },
      }),
    ).rejects.toMatchObject({
      response:
        'O botao COPY_CODE da Meta aceita no maximo 15 caracteres. Use o botao de pagamento para Pix copia e cola ou linha digitavel longos.',
      status: HttpStatus.BAD_REQUEST,
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('WhatsappService listOfficialTemplateStatuses', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('consulta a Meta e normaliza status e motivo de rejeicao dos templates', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              name: 'cobrapix_vencimento_hoje',
              language: 'pt_BR',
              status: 'APPROVED',
              rejected_reason: 'NONE',
            },
            {
              name: 'cobrapix_pre_vencimento',
              language: 'pt_BR',
              status: 'REJECTED',
              rejected_reason: 'SCAM',
            },
          ],
        }),
        { status: 200 },
      ),
    );
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    const statuses = await service.listOfficialTemplateStatuses('company-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v23.0/123456789/message_templates?fields=name,language,status,rejected_reason&limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(statuses).toEqual([
      {
        name: 'cobrapix_vencimento_hoje',
        language: 'pt_BR',
        status: 'APPROVED',
        rejectedReason: null,
      },
      {
        name: 'cobrapix_pre_vencimento',
        language: 'pt_BR',
        status: 'REJECTED',
        rejectedReason: 'SCAM',
      },
    ]);
  });
});
