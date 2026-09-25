import {
  BadRequestException,
  ConflictException,
  HttpException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ResendMailerService } from '../common/resend-mailer.service';
import type { PaymentCryptoService } from '../payment/payment-crypto.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { WhatsappService } from '../whatsapp/whatsapp.service';
import { CommunicationsService } from './communications.service';
import type { CommunicationAttributionService } from './communication-attribution.service';
import type { CommunicationTokenService } from './communication-token.service';

function setup(channel: 'WHATSAPP' | 'EMAIL' = 'WHATSAPP') {
  const prisma = {
    platformIntegrationState: {
      findUnique: jest.fn().mockResolvedValue({ enabled: true }),
    },
    communicationMessage: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    globalMessageTemplate: { findUnique: jest.fn() },
    communicationOutboundIntent: {
      findUnique: jest.fn().mockResolvedValue(null),
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
    enqueueAdminTemplate: jest.fn().mockResolvedValue({
      id: 'message-2',
      status: 'pending',
      externalMessageId: null,
    }),
    enqueueAdminReply: jest.fn().mockResolvedValue({
      id: 'message-1',
      status: 'pending',
      externalMessageId: null,
    }),
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
      META_PHONE_NUMBER_ID: '123',
    }),
    {} as CommunicationAttributionService,
    {} as CommunicationTokenService,
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

  it('enqueues admin WhatsApp replies with their stable idempotency key', async () => {
    const { service, prisma, whatsapp } = setup();
    await expect(
      service.replyToAdminConversation('conversation-1', {
        idempotencyId: 'request-1',
        content: 'Como podemos ajudar?',
      }),
    ).resolves.toMatchObject({ status: 'pending' });
    expect(whatsapp.enqueueAdminReply).toHaveBeenCalledWith(
      '5511999999999',
      'Como podemos ajudar?',
      'request-1',
      {},
    );
    expect(prisma.communicationMessage.create).not.toHaveBeenCalled();
    expect(whatsapp.sendTextMessage).not.toHaveBeenCalled();
    expect(prisma.communicationConversation.update).toHaveBeenCalledWith({
      where: { id: 'conversation-1' },
      data: {
        status: 'IN_PROGRESS',
        lastMessagePreview: 'Como podemos ajudar?',
        unreadCount: 0,
      },
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

  it('returns an already reserved reply on retry even after the window closed', async () => {
    const { service, prisma, whatsapp } = setup();
    prisma.communicationConversation.findUnique.mockResolvedValueOnce({
      id: 'conversation-1',
      channel: 'WHATSAPP',
      recipientEncrypted: 'ciphertext',
      serviceWindowExpiresAt: new Date(Date.now() - 1),
    });
    prisma.communicationOutboundIntent.findUnique.mockResolvedValueOnce({
      id: 'intent-1',
    });
    await expect(
      service.replyToAdminConversation('conversation-1', {
        idempotencyId: 'request-1',
        content: 'Como podemos ajudar?',
      }),
    ).resolves.toMatchObject({ id: 'message-1' });
    expect(prisma.communicationOutboundIntent.findUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: 'admin-reply:request-1' },
      select: { id: true },
    });
    expect(whatsapp.enqueueAdminReply).toHaveBeenCalled();
  });

  it('refuses company context or quotes on e-mail replies', async () => {
    const { service, resend } = setup('EMAIL');
    await expect(
      service.replyToAdminConversation('conversation-1', {
        idempotencyId: '40debb9b-9a1d-4e5c-84ab-d48d98223c26',
        content: 'Resposta',
        context: { companyId: '7d7f3a55-7a55-4f3c-9c8e-5b4bd1f2c001' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(resend.sendEmail).not.toHaveBeenCalled();
  });

  it('passes context and a quote of this conversation to the queued reply', async () => {
    const { service, prisma, whatsapp } = setup();
    prisma.communicationMessage.findFirst.mockResolvedValueOnce({
      externalMessageId: 'wamid.parent',
    });
    const context = {
      companyId: '7d7f3a55-7a55-4f3c-9c8e-5b4bd1f2c001',
      invoiceId: '7d7f3a55-7a55-4f3c-9c8e-5b4bd1f2c002',
    };
    await service.replyToAdminConversation('conversation-1', {
      idempotencyId: 'request-2',
      content: 'Recebemos seu comprovante',
      context,
      replyToMessageId: '7d7f3a55-7a55-4f3c-9c8e-5b4bd1f2c003',
    });
    expect(prisma.communicationMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: '7d7f3a55-7a55-4f3c-9c8e-5b4bd1f2c003',
          conversationId: 'conversation-1',
          transportChannelId: '123',
        }) as unknown,
      }),
    );
    expect(whatsapp.enqueueAdminReply).toHaveBeenCalledWith(
      '5511999999999',
      'Recebemos seu comprovante',
      'request-2',
      { context, replyToExternalMessageId: 'wamid.parent' },
    );
  });

  it('rejects quoting a message outside this conversation or channel', async () => {
    const { service, whatsapp } = setup();
    await expect(
      service.replyToAdminConversation('conversation-1', {
        idempotencyId: 'request-3',
        content: 'Oi',
        replyToMessageId: '7d7f3a55-7a55-4f3c-9c8e-5b4bd1f2c003',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(whatsapp.enqueueAdminReply).not.toHaveBeenCalled();
  });

  describe('template replies', () => {
    const template = {
      id: 'template-1',
      isActive: true,
      metaStatus: 'APPROVED',
      metaReviewRequired: false,
      metaTemplateName: 'cobranca_aviso',
      metaLanguage: 'pt_BR',
      content: 'Ola {{nome_devedor}}, valor {{valor}}.',
      paymentButtonEnabled: true,
    };
    const request = {
      idempotencyId: 'request-4',
      templateId: '7d7f3a55-7a55-4f3c-9c8e-5b4bd1f2c004',
      parameters: ['Ana', 'R$ 10,00'],
      context: {
        companyId: '7d7f3a55-7a55-4f3c-9c8e-5b4bd1f2c001',
        invoiceId: '7d7f3a55-7a55-4f3c-9c8e-5b4bd1f2c002',
      },
    };

    it('queues an approved template with the payment button built from the invoice', async () => {
      const { service, prisma, whatsapp } = setup();
      prisma.globalMessageTemplate.findUnique.mockResolvedValue(template);
      await service.replyWithTemplate('conversation-1', request);
      expect(whatsapp.enqueueAdminTemplate).toHaveBeenCalledWith(
        '5511999999999',
        {
          name: 'cobranca_aviso',
          language: 'pt_BR',
          content: 'Ola Ana, valor R$ 10,00.',
          parameters: ['Ana', 'R$ 10,00'],
          paymentButton: true,
        },
        'request-4',
        { context: request.context },
      );
    });

    it.each([
      [{ ...template, metaReviewRequired: true }, request],
      [{ ...template, metaStatus: 'PAUSED' }, request],
      [template, { ...request, parameters: ['Ana'] }],
      [template, { ...request, context: undefined }],
    ])(
      'rejects unavailable templates, wrong parameters or missing invoice',
      async (stored, body) => {
        const { service, prisma, whatsapp } = setup();
        prisma.globalMessageTemplate.findUnique.mockResolvedValue(stored);
        await expect(
          service.replyWithTemplate('conversation-1', body),
        ).rejects.toBeInstanceOf(HttpException);
        expect(whatsapp.enqueueAdminTemplate).not.toHaveBeenCalled();
      },
    );
  });
});
