import { OutboundDispatcherService } from './outbound-dispatcher.service';
import { WhatsappTransportError } from './transport/whatsapp-transport.error';
const dispatch = {
  attemptKey: jest.fn((series: string) => Promise.resolve(`${series}#1`)),
  send: jest
    .fn()
    .mockResolvedValue({ messageId: 'wamid.datafy', status: 'accepted' }),
};
import { DatafyRateLimitService } from './transport/datafy-rate-limit.service';
const testQuota = {
  acquire: jest.fn().mockResolvedValue(undefined),
} as unknown as DatafyRateLimitService;
import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsappService } from './whatsapp.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { createWhatsappTransport } from './transport/whatsapp-transport.module';

interface PrismaMock {
  communicationRecipientSuppression: { findUnique: jest.Mock };
  platformIntegrationState: { findUnique: jest.Mock };
  company: {
    findFirst: jest.Mock;
  };
  globalMessageTemplate: {
    updateMany: jest.Mock;
  };
  communicationConversation: { upsert: jest.Mock };
  communicationMessage: { upsert: jest.Mock };
}

function createPrismaMock(): PrismaMock {
  return {
    communicationRecipientSuppression: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    platformIntegrationState: { findUnique: jest.fn().mockResolvedValue(null) },
    company: {
      findFirst: jest.fn().mockResolvedValue({
        metaBusinessAccountId: '123456789',
        metaAccessTokenEncrypted: 'encrypted-token',
      }),
    },
    globalMessageTemplate: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    communicationConversation: {
      upsert: jest.fn().mockResolvedValue({ id: 'conversation-1' }),
    },
    communicationMessage: { upsert: jest.fn() },
  };
}

function createService(
  prisma: PrismaMock,
  overrides: Record<string, string> = {},
): WhatsappService {
  const config = {
    get: jest.fn((key: string, fallback?: string) => {
      if (key in overrides) return overrides[key];
      if (key === 'META_BUSINESS_ACCOUNT_ID') return '123456789';
      if (key === 'META_PHONE_NUMBER_ID') return '1234567890';
      if (key === 'DATAFY_API_TOKEN') return 'sk_live_test_only';
      return fallback;
    }),
  } as unknown as ConfigService;
  return new WhatsappService(
    config,
    prisma as unknown as PrismaService,
    {
      decrypt: jest.fn().mockReturnValue('plain-token'),
      encrypt: jest.fn().mockReturnValue('encrypted-recipient'),
    } as unknown as PaymentCryptoService,
    createWhatsappTransport(config, testQuota),
    dispatch as unknown as OutboundDispatcherService,
  );
}

describe('WhatsappService transporte selecionado', () => {
  afterEach(() => jest.restoreAllMocks());

  it('nao transmite texto nem template para destinatario com opt-out pendente', async () => {
    const prisma = createPrismaMock();
    prisma.communicationRecipientSuppression.findUnique.mockResolvedValue({
      id: 'blocked',
    });
    const service = createService(prisma);
    const http = jest.spyOn(globalThis, 'fetch');
    await expect(
      service.sendTemplateMessage({
        companyId: 'company-1',
        phoneNumber: '5511999999999',
        templateName: 'notice',
        languageCode: 'pt_BR',
        bodyParameters: [],
        idempotencyKey: 'suppressed-1',
      }),
    ).rejects.toThrow('Destinatario pausado');
    expect(http).not.toHaveBeenCalled();
    expect(dispatch.send).not.toHaveBeenCalled();
  });

  it('encaminha o envio Datafy ao dispatcher persistente sem exigir token Meta', async () => {
    const service = createService(createPrismaMock(), {
      DATAFY_API_TOKEN: 'synthetic',
    });
    await expect(
      service.sendTemplateMessage({
        companyId: 'company-1',
        phoneNumber: '5511999999999',
        templateName: 'notice',
        languageCode: 'pt_BR',
        bodyParameters: ['Ana'],
        idempotencyKey: 'request-1',
      }),
    ).resolves.toEqual({ messageId: 'wamid.datafy', status: 'accepted' });
    expect(dispatch.send).toHaveBeenCalledWith(
      {
        companyId: 'company-1',
        phoneNumber: '5511999999999',
        templateName: 'notice',
        languageCode: 'pt_BR',
        bodyParameters: ['Ana'],
        content: 'Template: notice',
        messageType: 'template',
      },
      'request-1',
    );
  });
});

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

  it('retorna diagnosticos permitidos sem repassar texto bruto do provedor', async () => {
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
    expect(httpException.message).not.toContain('Invalid parameter');
    expect(httpException.message).not.toContain(
      'template body cannot end with a parameter',
    );
    expect(httpException.message).toContain('2494073');
    expect(httpException.message).not.toContain('A_TEST_TRACE');
  });

  it('monta componentes BODY, FOOTER e BUTTONS para template oficial', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })))
      .mockResolvedValue(
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
      (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[1]?.[1]
        ?.body as string,
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

describe('WhatsappService sendTemplateMessage', () => {
  it('uses the next attempt key of a series without leaking the flag into the payload', async () => {
    const service = createService(createPrismaMock());
    await service.sendTemplateMessage({
      companyId: 'company-1',
      phoneNumber: '5511999999999',
      templateName: 'notice',
      languageCode: 'pt_BR',
      bodyParameters: ['Ana'],
      idempotencyKey: 'efi-onboarding-notice:company-1:2026-09-24',
      attemptSeries: true,
    });
    expect(dispatch.attemptKey).toHaveBeenCalledWith(
      'efi-onboarding-notice:company-1:2026-09-24',
    );
    expect(dispatch.send).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ attemptSeries: true }),
      'efi-onboarding-notice:company-1:2026-09-24#1',
    );
  });

  it('preserva esperas e resultados incertos do dispatcher', async () => {
    const service = createService(createPrismaMock());
    for (const error of [
      new WhatsappTransportError('aguarde', 'RATE_LIMIT', 'NOT_SENT'),
      new WhatsappTransportError('incerto', 'UNCERTAIN', 'UNCERTAIN'),
    ]) {
      dispatch.send.mockRejectedValueOnce(error);
      await expect(
        service.sendTemplateMessage({
          companyId: 'company-1',
          phoneNumber: '5511999999999',
          templateName: 'notice',
          languageCode: 'pt_BR',
          bodyParameters: [],
          idempotencyKey: 'collection-1',
        }),
      ).rejects.toBe(error);
    }
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
      'https://cloud.datafyapi.com.br/v1/123456789/message_templates?fields=id,name,language,status,rejected_reason,category,components,quality_score&limit=100',
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
