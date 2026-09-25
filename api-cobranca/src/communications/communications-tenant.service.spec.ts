import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PaymentCryptoService } from '../payment/payment-crypto.service';
import type { PrismaService } from '../prisma/prisma.service';
import { CommunicationTokenService } from './communication-token.service';
import { CommunicationsTenantService } from './communications-tenant.service';

const viewer = { userId: 'user-a', companyId: 'company-a' };
const tokens = new CommunicationTokenService(
  new ConfigService({
    JWT_SECRET: 'synthetic-jwt-secret-with-at-least-32-characters',
  }),
);

function setup() {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    communicationMessage: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    communicationConversation: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'conversation-1',
          channel: 'WHATSAPP',
          recipientEncrypted: '5511999999999',
          recipientAnonymizedAt: null,
        },
      ]),
    },
  };
  const service = new CommunicationsTenantService(
    prisma as unknown as PrismaService,
    { decrypt: (value: string) => value } as unknown as PaymentCryptoService,
    tokens,
  );
  return { service, prisma };
}

const message = (id: string, reply: string | null = null) => ({
  id,
  direction: 'INBOUND',
  content: `conteudo ${id}`,
  messageType: 'text',
  status: 'received',
  createdAt: new Date('2026-09-24T12:00:00.000Z'),
  replyToExternalMessageId: reply,
  invoice: null,
  debtor: null,
  attachments: [],
});

describe('CommunicationsTenantService', () => {
  it('filters every message read by the session company', async () => {
    const { service, prisma } = setup();
    prisma.communicationMessage.findMany.mockResolvedValueOnce([message('m1')]);
    await service.listMessages(viewer, 'conversation-1', { limit: 25 });
    const call = prisma.communicationMessage.findMany.mock.calls[0] as Array<{
      where: Record<string, unknown>;
    }>;
    expect(call[0]?.where).toMatchObject({
      conversationId: 'conversation-1',
      companyId: 'company-a',
    });
  });

  it('answers 404 when the company has no visible message in the conversation', async () => {
    const { service } = setup();
    await expect(
      service.listMessages(viewer, 'conversation-of-b', { limit: 25 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('still answers 404 for a cursor after the company lost access', async () => {
    const { service } = setup();
    const cursor = tokens.encodeCursor(
      {
        route: 'company-conversation-messages',
        userId: 'user-a',
        companyId: 'company-a',
        conversationId: 'conversation-1',
      },
      { at: new Date(), id: 'm1' },
    );
    await expect(
      service.listMessages(viewer, 'conversation-1', { limit: 25, cursor }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('omits quotes of messages outside the projection', async () => {
    const { service, prisma } = setup();
    prisma.communicationMessage.findMany
      .mockResolvedValueOnce([
        message('m2', 'wamid.of-b'),
        message('m1', 'wamid.a'),
      ])
      .mockResolvedValueOnce([
        {
          id: 'm0',
          direction: 'OUTBOUND',
          content: 'Cobranca A',
          externalMessageId: 'wamid.a',
        },
      ]);
    const result = await service.listMessages(viewer, 'conversation-1', {
      limit: 25,
    });
    const quotes = prisma.communicationMessage.findMany.mock.calls[1] as Array<{
      where: Record<string, unknown>;
    }>;
    expect(quotes[0]?.where).toMatchObject({ companyId: 'company-a' });
    expect(result.items).toEqual([
      expect.objectContaining({ id: 'm2', replyTo: null }),
      expect.objectContaining({
        id: 'm1',
        replyTo: { id: 'm0', direction: 'OUTBOUND', excerpt: 'Cobranca A' },
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('wamid');
  });

  it('rejects a cursor issued to another company or conversation', async () => {
    const { service } = setup();
    const foreign = tokens.encodeCursor(
      {
        route: 'company-conversation-messages',
        userId: 'user-b',
        companyId: 'company-b',
        conversationId: 'conversation-1',
      },
      { at: new Date(), id: 'm9' },
    );
    await expect(
      service.listMessages(viewer, 'conversation-1', {
        limit: 25,
        cursor: foreign,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.listConversations(viewer, { limit: 25, cursor: foreign }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
