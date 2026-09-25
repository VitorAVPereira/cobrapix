import { ConfigService } from '@nestjs/config';
import { CommunicationOutboundIntent } from '@prisma/client';
import { OutboundDispatcherService } from './outbound-dispatcher.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { OutboundIntentService } from '../communications/outbound-intent.service';
import {
  AcceptedMessage,
  WhatsappTransport,
} from './transport/whatsapp-transport';
import { MessageQueueService } from '../queue/message.queue';
import { RateLimitService } from '../queue/services/rate-limit.service';
import { MessagingLimitService } from '../queue/services/messaging-limit.service';
import { CommunicationTokenService } from '../communications/communication-token.service';
import { PublicPaymentLinkService } from '../payment/payment-link.service';
import { quickRepliesDeclared } from './outbound-dispatcher.service';

const approvedTemplate = {
  slug: 'aviso',
  isActive: true,
  metaStatus: 'APPROVED',
  metaReviewRequired: false,
  content: 'Ola {{nome_devedor}}',
  paymentButtonEnabled: true,
  metaComponents: [
    { type: 'BODY', text: 'Ola {{1}}' },
    {
      type: 'BUTTONS',
      buttons: [
        { type: 'URL', text: 'Pagar', url: 'https://x.test/pagar/{{1}}' },
        { type: 'QUICK_REPLY', text: 'Ja paguei' },
      ],
    },
  ],
};

function setup() {
  const input = {
    companyId: 'company-a',
    phoneNumber: '5511999999999',
    content: 'Teste',
    messageType: 'text',
  };
  const intent = {
    id: 'intent',
    messageId: 'message',
    transport: 'DATAFY',
    transportChannelId: '123',
    payloadEncrypted: JSON.stringify(input),
  } as CommunicationOutboundIntent;
  const prisma = {
    platformIntegrationState: { findUnique: jest.fn().mockResolvedValue(null) },
    communicationRecipientSuppression: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    communicationMessage: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        conversation: { serviceWindowExpiresAt: new Date(Date.now() + 1000) },
      }),
    },
    globalMessageTemplate: {
      findFirst: jest.fn().mockResolvedValue({
        isActive: true,
        metaStatus: 'PAUSED',
        metaReviewRequired: false,
      }),
    },
    invoice: { findFirst: jest.fn().mockResolvedValue(null) },
    debtor: { findFirst: jest.fn().mockResolvedValue(null) },
    companyTemplatePreference: { findUnique: jest.fn() },
    communicationInteractiveReference: {
      upsert: jest.fn().mockResolvedValue({}),
    },
  };
  const transport = {
    kind: 'DATAFY',
    sendText: jest.fn().mockResolvedValue({
      accepted: true,
      messageId: 'wamid',
      status: 'accepted',
    }),
    sendTemplate: jest.fn().mockResolvedValue({
      accepted: true,
      messageId: 'wamid-template',
      status: 'accepted',
    }),
  };
  const intents = {
    execute: jest.fn(
      async (
        _id: string,
        validate: (value: CommunicationOutboundIntent) => Promise<void>,
        transmit: (
          value: CommunicationOutboundIntent,
        ) => Promise<AcceptedMessage>,
      ) => {
        await validate(intent);
        return transmit(intent);
      },
    ),
  };
  const rates = {
    checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
  };
  const messaging = {
    canSend: jest.fn().mockResolvedValue({ allowed: true }),
    reserveDispatchQuota: jest.fn().mockResolvedValue(undefined),
  };
  const tokens = {
    interactiveToken: (messageId: string, index: number): string =>
      `cfm1.${messageId}-${index}`,
  };
  const paymentLinks = {
    createInvoicePaymentPage: jest
      .fn()
      .mockReturnValue({ token: 'signed-payment-token', url: 'unused' }),
  };
  const service = new OutboundDispatcherService(
    prisma as unknown as PrismaService,
    new ConfigService({ META_PHONE_NUMBER_ID: '123' }),
    { decrypt: (value: string): string => value } as PaymentCryptoService,
    intents as unknown as OutboundIntentService,
    transport as unknown as WhatsappTransport,
    {} as MessageQueueService,
    rates as unknown as RateLimitService,
    messaging as unknown as MessagingLimitService,
    tokens as unknown as CommunicationTokenService,
    paymentLinks as unknown as PublicPaymentLinkService,
  );
  return {
    service,
    intent,
    input,
    transport,
    prisma,
    rates,
    messaging,
    paymentLinks,
  };
}

describe('Shared outbound dispatch policies', () => {
  it('rechecks the window in the worker, after enqueue', async () => {
    const { service, transport, prisma } = setup();
    prisma.communicationMessage.findUniqueOrThrow.mockResolvedValue({
      conversation: { serviceWindowExpiresAt: new Date(0) },
    });
    await expect(service.dispatch('intent')).rejects.toThrow('janela');
    expect(transport.sendText).not.toHaveBeenCalled();
  });
  it('does not dispatch a template paused while in the queue', async () => {
    const { service, intent, input, transport } = setup();
    intent.payloadEncrypted = JSON.stringify({
      ...input,
      messageType: 'template',
      templateName: 'notice',
      languageCode: 'pt_BR',
      bodyParameters: [],
    });
    await expect(service.dispatch('intent')).rejects.toThrow(
      'Template indisponivel',
    );
    expect(transport.sendTemplate).not.toHaveBeenCalled();
  });
  it('enforces shared sender, recipient and commercial quotas on direct/recovery paths', async () => {
    const { service, rates, messaging } = setup();
    await service.dispatch('intent');
    expect(rates.checkRateLimit).toHaveBeenCalledWith(
      'sender:123',
      { maxMessages: 60, windowMs: 3600000 },
      'intent',
    );
    expect(messaging.reserveDispatchQuota).toHaveBeenCalledWith(
      'intent',
      '123',
      { commercial: true },
    );
  });
  it('holds queued intents while the channel is paused', async () => {
    const { service, transport, prisma } = setup();
    prisma.platformIntegrationState.findUnique.mockResolvedValue({
      enabled: false,
    });
    await expect(service.dispatch('intent')).rejects.toMatchObject({
      kind: 'TEMPORARY',
      outcome: 'NOT_SENT',
      retryAfterSeconds: 60,
    });
    expect(transport.sendText).not.toHaveBeenCalled();
  });
  it('fails before transport when selected provider changed', async () => {
    const { service, intent, transport } = setup();
    intent.transport = 'META_DIRECT';
    await expect(service.dispatch('intent')).rejects.toThrow(
      'TRANSPORT_CHANGED',
    );
    expect(transport.sendText).not.toHaveBeenCalled();
  });
  it('lets a platform reply answer a paid invoice without the collection rules', async () => {
    const { service, intent, input, prisma, messaging, transport } = setup();
    intent.payloadEncrypted = JSON.stringify({
      ...input,
      invoiceId: 'invoice-a',
      debtorId: 'debtor-a',
      origin: 'ADMIN_REPLY',
      replyToExternalMessageId: 'wamid.parent',
    });
    await service.dispatch('intent');
    expect(prisma.invoice.findFirst).not.toHaveBeenCalled();
    expect(messaging.reserveDispatchQuota).toHaveBeenCalledWith(
      'intent',
      '123',
      { commercial: false },
    );
    expect(transport.sendText).toHaveBeenCalledWith({
      to: '5511999999999',
      text: 'Teste',
      replyTo: 'wamid.parent',
    });
  });
  it('still rejects a collection whose invoice is no longer pending', async () => {
    const { service, intent, input, transport } = setup();
    intent.payloadEncrypted = JSON.stringify({
      ...input,
      invoiceId: 'invoice-a',
      debtorId: 'debtor-a',
    });
    await expect(service.dispatch('intent')).rejects.toThrow(
      'COLLECTION_NO_LONGER_ELIGIBLE',
    );
    expect(transport.sendText).not.toHaveBeenCalled();
  });
  it('builds the payment link at transmission and persists quick-reply references first', async () => {
    const { service, intent, input, prisma, transport, paymentLinks } = setup();
    prisma.globalMessageTemplate.findFirst.mockResolvedValue(approvedTemplate);
    intent.payloadEncrypted = JSON.stringify({
      ...input,
      invoiceId: 'invoice-a',
      origin: 'ADMIN_REPLY',
      messageType: 'template',
      templateName: 'aviso',
      languageCode: 'pt_BR',
      bodyParameters: ['Ana'],
      paymentButtonFromInvoice: true,
      quickReplyButtons: [1],
    });
    transport.sendTemplate.mockImplementation(() => {
      expect(
        prisma.communicationInteractiveReference.upsert,
      ).toHaveBeenCalled();
      return Promise.resolve({ accepted: true, messageId: 'w', status: null });
    });
    await service.dispatch('intent');
    expect(paymentLinks.createInvoicePaymentPage).toHaveBeenCalledWith({
      companyId: 'company-a',
      invoiceId: 'invoice-a',
    });
    expect(transport.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        components: [
          { type: 'body', parameters: [{ type: 'text', text: 'Ana' }] },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: 'signed-payment-token' }],
          },
          {
            type: 'button',
            sub_type: 'quick_reply',
            index: '1',
            parameters: [{ type: 'payload', payload: 'cfm1.message-1' }],
          },
        ],
      }),
    );
  });
  it('requires an invoice for a template with payment button', async () => {
    const { service, intent, input, prisma, transport } = setup();
    prisma.globalMessageTemplate.findFirst.mockResolvedValue(approvedTemplate);
    intent.payloadEncrypted = JSON.stringify({
      ...input,
      origin: 'ADMIN_REPLY',
      messageType: 'template',
      templateName: 'aviso',
      languageCode: 'pt_BR',
      bodyParameters: ['Ana'],
      paymentButtonFromInvoice: true,
    });
    await expect(service.dispatch('intent')).rejects.toThrow('Parametros');
    expect(transport.sendTemplate).not.toHaveBeenCalled();
  });
});

describe('quickRepliesDeclared', () => {
  it('accepts only QUICK_REPLY buttons declared by the approved template', () => {
    const components = approvedTemplate.metaComponents;
    expect(quickRepliesDeclared(components, undefined)).toBe(true);
    expect(quickRepliesDeclared(components, [1])).toBe(true);
    expect(quickRepliesDeclared(components, [0])).toBe(false);
    expect(quickRepliesDeclared(components, [1, 1])).toBe(false);
    expect(quickRepliesDeclared(components, [5])).toBe(false);
    expect(quickRepliesDeclared(null, [1])).toBe(false);
  });
});
