import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { CommunicationsService } from './communications.service';

describe('CommunicationsService', () => {
  const prisma = {
    communicationMessage: { findMany: jest.fn(), count: jest.fn() },
    communicationConversation: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const crypto = { decrypt: jest.fn() } as unknown as PaymentCryptoService;
  const service = new CommunicationsService(prisma as never, crypto);

  beforeEach(() => jest.clearAllMocks());

  it('filters customer outbound history by company and direction', async () => {
    prisma.communicationMessage.findMany.mockResolvedValue([]);
    prisma.communicationMessage.count.mockResolvedValue(0);

    await service.listOutbound('company-1', { page: 2, pageSize: 10 });

    expect(prisma.communicationMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'company-1', direction: 'OUTBOUND' },
        skip: 10,
        take: 10,
      }),
    );
  });

  it('does not return encrypted recipients in admin conversation summaries', async () => {
    prisma.communicationConversation.findMany.mockResolvedValue([
      {
        id: 'conversation-1',
        channel: 'WHATSAPP',
        recipientEncrypted: 'ciphertext',
        status: 'NEW',
        unreadCount: 1,
        lastMessagePreview: 'Oi',
        updatedAt: new Date('2026-09-09T12:00:00Z'),
      },
    ]);
    prisma.communicationConversation.count.mockResolvedValue(1);

    const result = await service.listAdminConversations({
      page: 1,
      pageSize: 20,
    });

    expect(result.items[0]).not.toHaveProperty('recipientEncrypted');
    expect(result.items[0]).toHaveProperty('recipient', null);
  });
});
