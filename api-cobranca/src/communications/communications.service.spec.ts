import { ConflictException, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ResendMailerService } from '../common/resend-mailer.service';
import type { PaymentCryptoService } from '../payment/payment-crypto.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { WhatsappService } from '../whatsapp/whatsapp.service';
import { CommunicationsService } from './communications.service';

function setup(channel: 'WHATSAPP' | 'EMAIL' = 'WHATSAPP') {
  const prisma = {
    platformIntegrationState: {
      findUnique: jest.fn().mockResolvedValue({ enabled: true }),
    },
    communicationMessage: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    communicationConversation: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn().mockResolvedValue({
        id: 'conversation-1',
        channel,
        recipientEncrypted: 'ciphertext',
        serviceWindowExpiresAt: new Date(Date.now() + 60_000),
      }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const crypto = {
    decrypt: jest
      .fn()
      .mockReturnValue(
        channel === 'EMAIL' ? 'cliente@example.com' : '5511999999999',
      ),
  };
  const whatsapp = {
    sendTextMessage: jest
      .fn()
      .mockResolvedValue({ messageId: 'wamid-1', status: 'sent' }),
  };
  const resend = { sendEmail: jest.fn().mockResolvedValue({ id: 'email-1' }) };
  const service = new CommunicationsService(
    prisma as unknown as PrismaService,
    crypto as unknown as PaymentCryptoService,
    whatsapp as unknown as WhatsappService,
    resend as unknown as ResendMailerService,
    new ConfigService({
      RESEND_API_KEY: 'central',
      RESEND_FROM_EMAIL: 'CifraMais <central@example.com>',
      RESEND_REPLY_TO: 'central@example.com',
    }),
  );
  return { service, prisma, whatsapp, resend };
}

describe('CommunicationsService', () => {
  it('filters customer history by tenant and never includes inbound messages', async () => {
    const { service, prisma } = setup();
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

  it('persists central intent without tenant association before WhatsApp delivery', async () => {
    const { service, prisma, whatsapp } = setup();
    await service.replyToAdminConversation('conversation-1', {
      idempotencyId: '40debb9b-9a1d-4e5c-84ab-d48d98223c26',
      content: 'Como podemos ajudar?',
    });
    expect(
      prisma.communicationMessage.create.mock.invocationCallOrder[0],
    ).toBeLessThan(whatsapp.sendTextMessage.mock.invocationCallOrder[0] ?? 0);
    const createMessage = prisma.communicationMessage.create as jest.Mock<
      Promise<unknown>,
      [unknown]
    >;
    expect(createMessage.mock.calls[0]?.[0]).toMatchObject({
      data: {
        companyId: null,
        invoiceId: null,
        debtorId: null,
        status: 'sending',
      },
    });
    expect(whatsapp.sendTextMessage).toHaveBeenCalledWith({
      companyId: null,
      phoneNumber: '5511999999999',
      text: 'Como podemos ajudar?',
      recordHistory: false,
    });
  });

  it('rejects WhatsApp reply outside the service window before persisting', async () => {
    const { service, prisma, whatsapp } = setup();
    prisma.communicationConversation.findUnique.mockResolvedValueOnce({
      id: 'conversation-1',
      channel: 'WHATSAPP',
      recipientEncrypted: 'ciphertext',
      serviceWindowExpiresAt: new Date(Date.now() - 1),
    });
    await expect(
      service.replyToAdminConversation('conversation-1', {
        idempotencyId: '40debb9b-9a1d-4e5c-84ab-d48d98223c26',
        content: 'Olá',
      }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(prisma.communicationMessage.create).not.toHaveBeenCalled();
    expect(whatsapp.sendTextMessage).not.toHaveBeenCalled();
  });

  it('returns an already sent response and blocks ambiguous resend', async () => {
    const { service, prisma, whatsapp } = setup();
    prisma.communicationMessage.findUnique.mockResolvedValueOnce({
      id: '40debb9b-9a1d-4e5c-84ab-d48d98223c26',
      conversationId: 'conversation-1',
      content: 'Olá',
      status: 'sent',
      externalMessageId: 'wamid-1',
    });
    await expect(
      service.replyToAdminConversation('conversation-1', {
        idempotencyId: '40debb9b-9a1d-4e5c-84ab-d48d98223c26',
        content: 'Olá',
      }),
    ).resolves.toEqual({
      id: '40debb9b-9a1d-4e5c-84ab-d48d98223c26',
      status: 'sent',
      externalMessageId: 'wamid-1',
    });
    prisma.communicationMessage.findUnique.mockResolvedValueOnce({
      id: '40debb9b-9a1d-4e5c-84ab-d48d98223c26',
      conversationId: 'conversation-1',
      status: 'sending',
      content: 'Olá',
      externalMessageId: null,
    });
    await expect(
      service.replyToAdminConversation('conversation-1', {
        idempotencyId: '40debb9b-9a1d-4e5c-84ab-d48d98223c26',
        content: 'Olá',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(whatsapp.sendTextMessage).not.toHaveBeenCalled();
  });

  it('uses central Resend settings and the frontend id as provider idempotency key', async () => {
    const { service, resend } = setup('EMAIL');
    await service.replyToAdminConversation('conversation-1', {
      idempotencyId: '40debb9b-9a1d-4e5c-84ab-d48d98223c26',
      content: 'Resposta segura',
    });
    expect(resend.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['cliente@example.com'],
        idempotencyKey: 'central-reply:40debb9b-9a1d-4e5c-84ab-d48d98223c26',
      }),
    );
  });
});
