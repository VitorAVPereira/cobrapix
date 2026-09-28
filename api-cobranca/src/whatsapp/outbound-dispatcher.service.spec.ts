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
import { TemplatePolicyService } from '../templates/template-policy.service';
import { TemplatePendingService } from '../communications/template-pending.service';
import { TemplateContextService } from '../templates/template-context.service';
import { TemplatePolicyError } from '../templates/template-contracts';
import { WhatsappTransportError } from './transport/whatsapp-transport.error';

const FINGERPRINT = 'f'.repeat(64);
const snapshot = {
  templateId: 'template-1',
  providerRevision: 1,
  mappingRevision: 1,
  policyVersion: 2,
  grantVersion: 1,
};
const templateRequest = {
  logicalKey: 'admin-template:reply-1',
  origin: 'ADMIN_REPLY',
  context: { companyId: 'company-a', invoiceId: 'invoice-a' },
  selection: { mode: 'EXPLICIT', templateId: 'template-1' },
};

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
    companyId: 'company-a',
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
    communicationOutboundIntent: {
      findUnique: jest.fn(() => Promise.resolve(intent)),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  Object.assign(prisma, {
    $transaction: jest.fn((run: (tx: unknown) => unknown) => run(prisma)),
  });
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
        _accepted: unknown,
        authorize?: (
          tx: unknown,
          value: CommunicationOutboundIntent,
        ) => Promise<void>,
      ) => {
        if (authorize) await authorize(prisma, intent);
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
  const policy = {
    assertPinned: jest.fn().mockResolvedValue({
      snapshot,
      mapping: { body: { '1': { kind: 'SOURCE', source: 'DEBTOR_NAME' } } },
    }),
  };
  const pending = {
    findByLogicalKey: jest.fn().mockResolvedValue(null),
    block: jest.fn().mockResolvedValue({ id: 'pending-1' }),
    reconcileInvalidSnapshots: jest.fn().mockResolvedValue(0),
  };
  const templateContext = {
    load: jest.fn().mockResolvedValue({ contextFingerprint: FINGERPRINT }),
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
    policy as unknown as TemplatePolicyService,
    pending as unknown as TemplatePendingService,
    templateContext as unknown as TemplateContextService,
  );
  /** Turns the test intent into a prepared template intent pinned to a snapshot. */
  const pinTemplate = (extra: Record<string, unknown> = {}) => {
    Object.assign(intent, {
      logicalKey: templateRequest.logicalKey,
      templateSnapshot: snapshot,
      templateContextFingerprint: FINGERPRINT,
      templateContext: {
        logicalKey: templateRequest.logicalKey,
        request: templateRequest,
      },
      payloadEncrypted: JSON.stringify({
        ...input,
        invoiceId: 'invoice-a',
        origin: 'ADMIN_REPLY',
        messageType: 'template',
        templateName: 'cobranca',
        languageCode: 'pt_BR',
        bodyParameters: ['Ana'],
        paymentButtonFromInvoice: true,
        ...extra,
      }),
    });
  };
  return {
    pinTemplate,
    policy,
    pending,
    templateContext,
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
  it('does not dispatch a template paused while in the queue: holds it', async () => {
    const { service, pinTemplate, policy, pending, transport } = setup();
    pinTemplate();
    policy.assertPinned.mockRejectedValue(
      new TemplatePolicyError('NOT_APPROVED'),
    );
    await expect(service.dispatch('intent')).rejects.toMatchObject({
      code: 'NOT_APPROVED',
    });
    expect(transport.sendTemplate).not.toHaveBeenCalled();
    expect(pending.block).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        code: 'NOT_APPROVED',
        intentId: 'intent',
        snapshot,
        request: templateRequest,
      }),
    );
  });
  it('admin_reply_still_needs_grant', async () => {
    const { service, pinTemplate, policy, transport } = setup();
    pinTemplate();
    policy.assertPinned.mockRejectedValue(
      new TemplatePolicyError('NOT_GRANTED'),
    );
    await expect(service.dispatch('intent')).rejects.toBeInstanceOf(
      TemplatePolicyError,
    );
    expect(policy.assertPinned).toHaveBeenCalledWith(
      expect.anything(),
      'company-a',
      snapshot,
    );
    expect(transport.sendTemplate).not.toHaveBeenCalled();
  });
  it('never authorizes a legacy template payload implicitly', async () => {
    const { service, intent, input, pending, transport } = setup();
    intent.payloadEncrypted = JSON.stringify({
      ...input,
      invoiceId: 'invoice-a',
      messageType: 'template',
      templateName: 'notice',
      languageCode: 'pt_BR',
      bodyParameters: ['Ana'],
    });
    await expect(service.dispatch('intent')).rejects.toMatchObject({
      code: 'LEGACY_PAYLOAD',
    });
    expect(pending.block).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        code: 'LEGACY_PAYLOAD',
        request: expect.objectContaining({
          selection: { mode: 'UNCONFIGURED' },
        }) as unknown,
      }),
    );
    expect(transport.sendTemplate).not.toHaveBeenCalled();
  });
  it('holds when recipient, amount or links changed since preparation', async () => {
    const { service, pinTemplate, templateContext, transport } = setup();
    pinTemplate();
    templateContext.load.mockResolvedValue({
      contextFingerprint: 'e'.repeat(64),
    });
    await expect(service.dispatch('intent')).rejects.toMatchObject({
      code: 'CONTEXT_CHANGED',
    });
    expect(transport.sendTemplate).not.toHaveBeenCalled();
  });
  it('refuses a send while a hold exists for the same communication', async () => {
    const { service, pinTemplate, pending, transport } = setup();
    pinTemplate();
    pending.findByLogicalKey.mockResolvedValue({
      id: 'pending-1',
      state: 'BLOCKED',
      version: 1,
      currentIntentId: 'intent',
    });
    await expect(service.dispatch('intent')).rejects.toMatchObject({
      code: 'VERSION_CHANGED',
    });
    expect(transport.sendTemplate).not.toHaveBeenCalled();
  });
  it('turns a provider template refusal into a hold and a catalog re-read', async () => {
    const { service, pinTemplate, pending, transport, prisma } = setup();
    pinTemplate();
    transport.sendTemplate.mockRejectedValue(
      new WhatsappTransportError('paused', 'REJECTED', 'REJECTED', 400, 132015),
    );
    await expect(service.dispatch('intent')).rejects.toMatchObject({
      code: 'NOT_APPROVED',
    });
    // The Datafy account is not configured in this test, so no sync request is written.
    expect(JSON.stringify(prisma.$executeRaw.mock.calls)).not.toContain(
      'WhatsappTemplateSyncState',
    );
    expect(pending.block).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: 'NOT_APPROVED' }),
    );
  });
  it('keeps an uncertain provider result out of the hold flow', async () => {
    const { service, pinTemplate, pending, transport } = setup();
    pinTemplate();
    const uncertain = new WhatsappTransportError(
      'timeout',
      'UNCERTAIN',
      'UNCERTAIN',
      undefined,
      132015,
    );
    transport.sendTemplate.mockRejectedValue(uncertain);
    await expect(service.dispatch('intent')).rejects.toBe(uncertain);
    expect(pending.block).not.toHaveBeenCalled();
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
  it('builds the payment link at transmission for the pinned invoice', async () => {
    const { service, pinTemplate, transport, paymentLinks } = setup();
    pinTemplate();
    await service.dispatch('intent');
    expect(paymentLinks.createInvoicePaymentPage).toHaveBeenCalledWith({
      companyId: 'company-a',
      invoiceId: 'invoice-a',
    });
    expect(transport.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'cobranca',
        components: [
          { type: 'body', parameters: [{ type: 'text', text: 'Ana' }] },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: 'signed-payment-token' }],
          },
        ],
      }),
    );
  });
  it('refuses quick replies the approved catalog does not support', async () => {
    const { service, pinTemplate, transport } = setup();
    pinTemplate({ quickReplyButtons: [1] });
    await expect(service.dispatch('intent')).rejects.toMatchObject({
      code: 'UNSUPPORTED',
    });
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
