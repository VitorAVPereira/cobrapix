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
