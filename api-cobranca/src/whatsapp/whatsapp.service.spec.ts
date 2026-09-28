import { OutboundDispatcherService } from './outbound-dispatcher.service';
const dispatch = {
  dispatch: jest
    .fn()
    .mockResolvedValue({ messageId: 'wamid.datafy', status: 'accepted' }),
  enqueue: jest.fn().mockResolvedValue({
    id: 'message-1',
    status: 'pending',
    externalMessageId: null,
  }),
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

  it('dispatches prepared intents only through the persistent dispatcher', async () => {
    const service = createService(createPrismaMock());
    const http = jest.spyOn(globalThis, 'fetch');
    await expect(service.dispatchIntent('intent-1')).resolves.toEqual({
      messageId: 'wamid.datafy',
      status: 'accepted',
    });
    expect(dispatch.dispatch).toHaveBeenCalledWith('intent-1');
    expect(http).not.toHaveBeenCalled();
  });

  it('queues free-text admin replies with their validated context', async () => {
    const service = createService(createPrismaMock());
    await service.enqueueAdminReply('5511999999999', 'Olá', 'reply-1', {
      context: { companyId: 'company-1', invoiceId: 'invoice-1' },
    });
    expect(dispatch.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        invoiceId: 'invoice-1',
        messageType: 'text',
        origin: 'ADMIN_REPLY',
      }),
      'admin-reply:reply-1',
    );
  });
});
