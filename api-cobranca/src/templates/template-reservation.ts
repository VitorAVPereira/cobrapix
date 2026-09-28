import { Prisma } from '@prisma/client';
import type { OutboundIntentService } from '../communications/outbound-intent.service';
import { messageRecipient } from '../communications/message-context';
import type { PaymentCryptoService } from '../payment/payment-crypto.service';
import type { DispatchInput } from '../whatsapp/outbound-dispatcher.service';
import type {
  LoadedTemplateContext,
  TemplateContextService,
} from './template-context.service';
import type {
  ReadyTemplate,
  TemplateBlockCode,
  TemplateSendRequest,
} from './template-contracts';
import { renderTemplate } from './template-renderer';

type Tx = Prisma.TransactionClient;

export type RenderedSend = {
  loaded: LoadedTemplateContext;
  recipient: string;
  body: string;
  bodyParameters: string[];
};

export type RenderOutcome =
  | ({ ok: true } & RenderedSend)
  | { ok: false; code: TemplateBlockCode; field?: string; cause?: unknown };

/**
 * Loads the trusted context of a request and renders the pinned template. Admin replies
 * go to the conversation's recipient; everything else to the context's own person.
 */
export async function renderSend(
  context: TemplateContextService,
  crypto: PaymentCryptoService,
  tx: Tx,
  request: TemplateSendRequest,
  template: ReadyTemplate,
): Promise<RenderOutcome> {
  let loaded: LoadedTemplateContext;
  try {
    loaded = await context.load(
      request.context,
      request.origin,
      template.mapping,
      tx,
    );
  } catch (cause: unknown) {
    return { ok: false, code: 'VALUE_MISSING', cause };
  }
  const recipient =
    request.origin === 'ADMIN_REPLY'
      ? await conversationRecipient(crypto, tx, request.conversationId)
      : loaded.recipient;
  if (!recipient)
    return { ok: false, code: 'VALUE_MISSING', field: 'RECIPIENT' };
  const rendered = renderTemplate(
    template.parsed,
    template.mapping,
    loaded.values,
    loaded.paymentUrl,
  );
  if (!rendered.ok)
    return { ok: false, code: rendered.code, field: rendered.field };
  return {
    ok: true,
    loaded,
    recipient,
    body: rendered.body,
    bodyParameters: rendered.bodyParameters,
  };
}

async function conversationRecipient(
  crypto: PaymentCryptoService,
  tx: Tx,
  conversationId: string | undefined,
): Promise<string | null> {
  if (!conversationId) return null;
  const conversation = await tx.communicationConversation.findUnique({
    where: { id: conversationId },
    select: { channel: true, recipientType: true, recipientEncrypted: true },
  });
  if (
    conversation?.channel !== 'WHATSAPP' ||
    conversation.recipientType === 'BSUID' ||
    !conversation.recipientEncrypted
  )
    return null;
  return crypto.decrypt(conversation.recipientEncrypted);
}

const RETENTION_YEARS = 5;

/** Reserves the intent of a rendered template send inside the caller's transaction. */
export async function reserveTemplateIntent(
  deps: {
    intents: OutboundIntentService;
    crypto: PaymentCryptoService;
    transportChannelId: string;
  },
  tx: Tx,
  input: {
    request: TemplateSendRequest;
    template: ReadyTemplate;
    rendered: RenderedSend;
    idempotencyKey: string;
    generation: number;
    resumeReviewId?: string;
  },
): Promise<string> {
  const { request, template, rendered } = input;
  const phone = messageRecipient({ type: 'PHONE', value: rendered.recipient });
  const retentionExpiresAt = new Date();
  retentionExpiresAt.setUTCFullYear(
    retentionExpiresAt.getUTCFullYear() + RETENTION_YEARS,
  );
  const conversation = await tx.communicationConversation.upsert({
    where: {
      channel_recipientHash: { channel: 'WHATSAPP', recipientHash: phone.hash },
    },
    create: {
      channel: 'WHATSAPP',
      recipientHash: phone.hash,
      recipientType: 'PHONE',
      recipientEncrypted: deps.crypto.encrypt(phone.value),
      retentionExpiresAt,
    },
    update: {},
    select: { id: true },
  });
  const { companyId, invoiceId, debtorId } = request.context;
  const adminReply = request.origin === 'ADMIN_REPLY';
  const payload: DispatchInput = {
    companyId,
    ...(invoiceId ? { invoiceId } : {}),
    ...(debtorId ? { debtorId } : {}),
    ...(request.ruleStepId ? { ruleStepId: request.ruleStepId } : {}),
    phoneNumber: phone.value,
    content: rendered.body,
    messageType: 'template',
    templateName: template.name,
    languageCode: template.language,
    bodyParameters: rendered.bodyParameters,
    ...(template.parsed.paymentButton
      ? { paymentButtonFromInvoice: true }
      : {}),
    ...(adminReply ? { origin: 'ADMIN_REPLY' as const } : {}),
    ...(request.replyToExternalMessageId
      ? { replyToExternalMessageId: request.replyToExternalMessageId }
      : {}),
  };
  const { reservation } = await deps.intents.reserveInTransaction(tx, {
    idempotencyKey: input.idempotencyKey,
    conversationId: conversation.id,
    transport: 'DATAFY',
    transportChannelId: deps.transportChannelId,
    recipient: phone,
    context: {
      companyId,
      ...(invoiceId ? { invoiceId } : {}),
      ...(debtorId ? { debtorId } : {}),
    },
    content: rendered.body,
    messageType: 'template',
    payload,
    retentionExpiresAt,
    replyToExternalMessageId: request.replyToExternalMessageId ?? null,
    template: {
      logicalKey: request.logicalKey,
      generation: input.generation,
      snapshot: template.snapshot,
      contextFingerprint: rendered.loaded.contextFingerprint,
      context: { logicalKey: request.logicalKey, request },
      resumeReviewId: input.resumeReviewId ?? null,
    },
  });
  return reservation.id;
}
