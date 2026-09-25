import { BadRequestException } from '@nestjs/common';
import {
  CommunicationAttributionMethod,
  CommunicationRecipientType,
  Prisma,
} from '@prisma/client';
import {
  INTERACTIVE_TOKEN_PATTERN,
  interactiveTokenHash,
} from './communication-token.service';
import {
  MessageContext,
  MessageContextInput,
  messageRecipient,
  normalizeMessageContext,
} from './message-context';

type Tx = Prisma.TransactionClient;
type ResolvedMethod = Extract<
  CommunicationAttributionMethod,
  'UNASSIGNED' | 'REPLY_CONTEXT' | 'INTERACTIVE_CONTEXT'
>;

export interface InboundReference {
  conversationId: string;
  recipientHash: string;
  recipientType: CommunicationRecipientType;
  channelId: string;
  replyToExternalMessageId: string | null;
  interactiveToken: string | null;
}

export interface ResolvedAttribution {
  context: MessageContext;
  method: ResolvedMethod;
}

const UNASSIGNED: ResolvedAttribution = {
  context: { companyId: null, invoiceId: null, debtorId: null },
  method: 'UNASSIGNED',
};
const MAX_REPLY_DEPTH = 5;
const REPLY_BATCH = 100;

/** Company, invoice and debtor must belong together and to this recipient. */
export async function validateMessageContext(
  tx: Tx,
  input: MessageContextInput,
  recipient: { hash: string; type: CommunicationRecipientType },
): Promise<MessageContext> {
  const context = normalizeMessageContext(input);
  if (!context.companyId) return context;
  // No reconciled BSUID/debtor mapping exists yet. Never infer it from digits.
  if (recipient.type !== 'PHONE')
    throw new BadRequestException(
      'Identidade do destinatario ainda nao conciliada',
    );
  const company = await tx.company.findUnique({
    where: { id: context.companyId },
    select: { id: true },
  });
  if (!company)
    throw new BadRequestException('Contexto de comunicacao invalido');
  if (context.invoiceId) {
    const invoice = await tx.invoice.findFirst({
      where: { id: context.invoiceId, companyId: context.companyId },
      select: { debtorId: true },
    });
    if (!invoice || (context.debtorId && invoice.debtorId !== context.debtorId))
      throw new BadRequestException(
        'Cobranca e devedor devem pertencer ao contexto informado',
      );
    context.debtorId = invoice.debtorId;
  }
  if (context.debtorId) {
    const debtor = await tx.debtor.findFirst({
      where: { id: context.debtorId, companyId: context.companyId },
      select: { phoneNumber: true },
    });
    if (
      !debtor?.phoneNumber ||
      messageRecipient({ type: 'PHONE', value: debtor.phoneNumber }).hash !==
        recipient.hash
    )
      throw new BadRequestException('Devedor nao corresponde ao destinatario');
  }
  return context;
}

interface SourceMessage {
  conversationId: string;
  transportChannelId: string | null;
  companyId: string | null;
  invoiceId: string | null;
  debtorId: string | null;
  anonymizedAt: Date | null;
  retentionExpiresAt: Date;
}

/**
 * The referenced message must be persisted in the same conversation (same contact)
 * and the same proven channel, and already belong to a company. Its context is revalidated.
 */
async function inherit(
  tx: Tx,
  source: SourceMessage | null,
  reference: InboundReference,
): Promise<MessageContext | null> {
  if (
    !source?.companyId ||
    source.conversationId !== reference.conversationId ||
    !source.transportChannelId ||
    source.transportChannelId !== reference.channelId ||
    source.anonymizedAt ||
    source.retentionExpiresAt <= new Date()
  )
    return null;
  try {
    return await validateMessageContext(
      tx,
      {
        companyId: source.companyId,
        invoiceId: source.invoiceId,
        debtorId: source.debtorId,
      },
      { hash: reference.recipientHash, type: reference.recipientType },
    );
  } catch {
    return null;
  }
}

const sourceSelect = {
  conversationId: true,
  transportChannelId: true,
  companyId: true,
  invoiceId: true,
  debtorId: true,
  anonymizedAt: true,
  retentionExpiresAt: true,
} satisfies Prisma.CommunicationMessageSelect;

/** Never infers a company from the phone, recency or payload fields; only persisted references. */
export async function resolveInboundAttribution(
  tx: Tx,
  reference: InboundReference,
): Promise<ResolvedAttribution> {
  if (
    reference.interactiveToken &&
    INTERACTIVE_TOKEN_PATTERN.test(reference.interactiveToken)
  ) {
    const issued = await tx.communicationInteractiveReference.findUnique({
      where: { tokenHash: interactiveTokenHash(reference.interactiveToken) },
      select: {
        message: { select: { ...sourceSelect, direction: true } },
      },
    });
    const context =
      issued?.message.direction === 'OUTBOUND'
        ? await inherit(tx, issued.message, reference)
        : null;
    if (context) return { context, method: 'INTERACTIVE_CONTEXT' };
  }
  if (reference.replyToExternalMessageId) {
    const cited = await tx.communicationMessage.findUnique({
      where: { externalMessageId: reference.replyToExternalMessageId },
      select: sourceSelect,
    });
    const context = await inherit(tx, cited, reference);
    if (context) return { context, method: 'REPLY_CONTEXT' };
  }
  return UNASSIGNED;
}

/**
 * Re-resolves replies citing a message whose context or external ID just changed.
 * Manual and interactive attributions are never overwritten; nothing spreads to the whole conversation.
 */
export async function reevaluateReplies(
  tx: Tx,
  messageId: string,
  depth = 0,
): Promise<void> {
  if (depth >= MAX_REPLY_DEPTH) return;
  const source = await tx.communicationMessage.findUnique({
    where: { id: messageId },
    select: {
      externalMessageId: true,
      conversationId: true,
      transportChannelId: true,
    },
  });
  if (!source?.externalMessageId || !source.transportChannelId) return;
  const conversation = await tx.communicationConversation.findUniqueOrThrow({
    where: { id: source.conversationId },
    select: { recipientHash: true, recipientType: true },
  });
  // Every dependent quotes the same message in the same conversation: resolve once.
  const resolved = await resolveInboundAttribution(tx, {
    conversationId: source.conversationId,
    recipientHash: conversation.recipientHash,
    recipientType: conversation.recipientType ?? 'PHONE',
    channelId: source.transportChannelId,
    replyToExternalMessageId: source.externalMessageId,
    interactiveToken: null,
  });
  // All dependents are visited, in id batches; none is silently left behind.
  for (let after: string | undefined; ; ) {
    const dependents = await tx.communicationMessage.findMany({
      where: {
        conversationId: source.conversationId,
        transportChannelId: source.transportChannelId,
        replyToExternalMessageId: source.externalMessageId,
        attributionMethod: { in: ['UNASSIGNED', 'REPLY_CONTEXT'] },
        outboundIntent: null,
        anonymizedAt: null,
        ...(after ? { id: { gt: after } } : {}),
      },
      select: {
        id: true,
        companyId: true,
        invoiceId: true,
        debtorId: true,
        attributionMethod: true,
        attributionRevision: true,
      },
      orderBy: { id: 'asc' },
      take: REPLY_BATCH,
    });
    for (const dependent of dependents) {
      if (
        resolved.method === dependent.attributionMethod &&
        resolved.context.companyId === dependent.companyId &&
        resolved.context.invoiceId === dependent.invoiceId &&
        resolved.context.debtorId === dependent.debtorId
      )
        continue;
      const updated = await tx.communicationMessage.updateMany({
        where: {
          id: dependent.id,
          attributionRevision: dependent.attributionRevision,
          attributionMethod: dependent.attributionMethod,
        },
        data: {
          ...resolved.context,
          attributionMethod: resolved.method,
          attributionRevision: { increment: 1 },
        },
      });
      // A concurrent manual correction wins; it is never overwritten here.
      if (!updated.count) continue;
      await tx.communicationAttributionAudit.create({
        data: {
          messageId: dependent.id,
          actorType: 'SYSTEM',
          method: resolved.method,
          oldContext: {
            companyId: dependent.companyId,
            invoiceId: dependent.invoiceId,
            debtorId: dependent.debtorId,
          },
          newContext: { ...resolved.context },
          reason: 'Referencia citada reavaliada',
          revision: dependent.attributionRevision + 1,
        },
      });
      await reevaluateReplies(tx, dependent.id, depth + 1);
    }
    if (dependents.length < REPLY_BATCH) return;
    after = dependents.at(-1)?.id;
  }
}
