import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { canonicalPayload } from '../communications/message-context';
import {
  reevaluateReplies,
  resolveInboundAttribution,
} from '../communications/reply-attribution';
import { applyTemplateEvent } from '../templates/template-provider-state';
import {
  DatafyEvent,
  DatafyMessageEvent,
  DatafyStatusEvent,
} from './datafy-event.types';

const DAY = 86_400_000;

/** Internal, global channel processing. No tenant is inferred from a phone number. */
@Injectable()
export class DatafyEventProcessor {
  constructor(private readonly crypto: PaymentCryptoService) {}

  async apply(
    tx: Prisma.TransactionClient,
    events: DatafyEvent[],
    deliveryId: string,
    channelId: string,
    retryContext = false,
  ): Promise<boolean> {
    let review = false;
    for (const event of events) {
      if (event.kind === 'MESSAGE')
        review =
          (await this.recordInbound(tx, event, channelId)) ||
          event.optOut ||
          review;
      else if (event.kind === 'STATUS')
        review =
          (await this.status(tx, event, deliveryId, channelId, retryContext)) ||
          review;
      else if (
        event.kind === 'TEMPLATE' &&
        event.field &&
        event.value &&
        event.timestamp
      )
        review =
          (await applyTemplateEvent(
            tx,
            event.field,
            event.value,
            event.timestamp,
          )) || review;
      else review = true;
    }
    return review;
  }

  async recordInbound(
    tx: Prisma.TransactionClient,
    event: DatafyMessageEvent,
    channelId: string,
  ): Promise<boolean> {
    if (event.optOut) {
      // A preference must survive expired/anonymized history and legacy duplicate messages.
      await tx.communicationRecipientSuppression.upsert({
        where: {
          channel_recipientHash: {
            channel: 'WHATSAPP',
            recipientHash: event.recipient.hash,
          },
        },
        create: {
          channel: 'WHATSAPP',
          recipientType: event.recipient.type,
          recipientHash: event.recipient.hash,
          reasonCode: 'OPT_OUT_REVIEW_REQUIRED',
          blockedAt: event.timestamp,
        },
        update: {},
      });
    }
    const duplicate = await tx.communicationMessage.findUnique({
      where: { externalMessageId: event.externalMessageId },
      select: { id: true },
    });
    if (duplicate) return false;
    const expiry = new Date(event.timestamp);
    expiry.setUTCFullYear(expiry.getUTCFullYear() + 5);
    if (expiry <= new Date()) return true;
    await tx.communicationConversation.createMany({
      data: {
        id: randomUUID(),
        channel: 'WHATSAPP',
        recipientHash: event.recipient.hash,
        recipientType: event.recipient.type,
        recipientEncrypted: this.crypto.encrypt(event.recipient.value),
        retentionExpiresAt: expiry,
      },
      skipDuplicates: true,
    });
    const [locked] = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "CommunicationConversation" WHERE "channel" = 'WHATSAPP'
      AND "recipientHash" = ${event.recipient.hash} FOR UPDATE`);
    if (!locked) throw new Error('CONVERSATION_NOT_FOUND');
    const conversation = await tx.communicationConversation.findUniqueOrThrow({
      where: { id: locked.id },
    });
    if (
      conversation.recipientAnonymizedAt ||
      conversation.retentionExpiresAt <= new Date()
    )
      return true;
    const messageId = randomUUID();
    // Only a persisted citation or server-issued button reference assigns a company.
    const attribution = await resolveInboundAttribution(tx, {
      conversationId: conversation.id,
      recipientHash: event.recipient.hash,
      recipientType: event.recipient.type,
      channelId,
      replyToExternalMessageId: event.replyToExternalMessageId,
      interactiveToken: event.interactiveToken,
    });
    const retentionExpiresAt = new Date(
      Math.min(expiry.getTime(), conversation.retentionExpiresAt.getTime()),
    );
    const inserted = await tx.communicationMessage.createMany({
      data: {
        id: messageId,
        conversationId: conversation.id,
        ...attribution.context,
        direction: 'INBOUND',
        content: event.content,
        externalMessageId: event.externalMessageId,
        transportChannelId: channelId,
        recipientType: event.recipient.type,
        replyToExternalMessageId: event.replyToExternalMessageId,
        source: 'LIVE',
        messageType: event.messageType,
        providerTimestamp: event.timestamp,
        createdAt: event.timestamp,
        status: 'received',
        statusOccurredAt: event.timestamp,
        attributionMethod: attribution.method,
        retentionExpiresAt,
      },
      skipDuplicates: true,
    });
    if (!inserted.count) return false;
    // A reply citing this message may have arrived first.
    await reevaluateReplies(tx, messageId);
    const newest =
      !conversation.lastInboundAt ||
      event.timestamp > conversation.lastInboundAt;
    await tx.communicationConversation.update({
      where: { id: conversation.id },
      data: {
        unreadCount: { increment: 1 },
        ...(newest
          ? {
              lastInboundAt: event.timestamp,
              serviceWindowExpiresAt: new Date(event.timestamp.getTime() + DAY),
              lastMessagePreview: event.content.slice(0, 255),
            }
          : {}),
      },
    });
    if (event.attachment)
      await tx.communicationAttachment.create({
        data: { messageId, ...event.attachment, retentionExpiresAt },
      });
    return event.optOut;
  }

  private async status(
    tx: Prisma.TransactionClient,
    event: DatafyStatusEvent,
    deliveryId: string,
    channelId: string,
    retryContext: boolean,
  ): Promise<boolean> {
    const eventKey = createHash('sha256')
      .update(
        canonicalPayload({
          channelId,
          id: event.externalMessageId,
          recipientHash: event.recipient.hash,
          status: event.status,
          timestamp: event.timestamp.toISOString(),
          errors: event.errorCodes,
        }),
      )
      .digest('hex');
    await tx.communicationMessageStatusEvent.createMany({
      data: {
        id: randomUUID(),
        eventKey,
        deliveryId,
        externalMessageId: event.externalMessageId,
        transportChannelId: channelId,
        recipientType: event.recipient.type,
        recipientHash: event.recipient.hash,
        status: event.status,
        occurredAt: event.timestamp,
        errorCodes: event.errorCodes,
        retentionExpiresAt: new Date(Date.now() + 7 * DAY),
      },
      skipDuplicates: true,
    });
    const record = await tx.communicationMessageStatusEvent.findUniqueOrThrow({
      where: { eventKey },
      select: { id: true },
    });
    if (retryContext) {
      // Only an explicit admin replay reopens unresolved context. Never reset successful effects.
      await tx.communicationMessageStatusEvent.updateMany({
        where: {
          id: record.id,
          resolutionCode: { in: ['CONTEXT_NOT_FOUND', 'CONTEXT_MISMATCH'] },
        },
        data: {
          appliedAt: null,
          resolutionCode: null,
          nextAttemptAt: new Date(),
        },
      });
    }
    await this.reconcileStatus(tx, record.id);
    const resolved = await tx.communicationMessageStatusEvent.findUniqueOrThrow(
      { where: { id: record.id }, select: { resolutionCode: true } },
    );
    return (
      resolved.resolutionCode === 'CONTEXT_NOT_FOUND' ||
      resolved.resolutionCode === 'CONTEXT_MISMATCH'
    );
  }

  async reconcileStatus(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "CommunicationMessageStatusEvent" WHERE "id" = ${id} AND "appliedAt" IS NULL FOR UPDATE SKIP LOCKED`);
    if (!rows.length) return;
    const event = await tx.communicationMessageStatusEvent.findUniqueOrThrow({
      where: { id },
    });
    const [locked] = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "CommunicationMessage" WHERE "externalMessageId" = ${event.externalMessageId} FOR UPDATE`);
    const message = locked
      ? await tx.communicationMessage.findUnique({
          where: { id: locked.id },
          include: { conversation: true },
        })
      : null;
    if (!message && event.retentionExpiresAt > new Date()) {
      await tx.communicationMessageStatusEvent.update({
        where: { id },
        data: { nextAttemptAt: new Date(Date.now() + 30_000) },
      });
      return;
    }
    let resolutionCode = 'APPLIED';
    if (!message) resolutionCode = 'CONTEXT_NOT_FOUND';
    else if (
      message.direction !== 'OUTBOUND' ||
      message.conversation.channel !== 'WHATSAPP' ||
      message.conversation.recipientHash !== event.recipientHash ||
      (message.transportChannelId &&
        message.transportChannelId !== event.transportChannelId)
    )
      resolutionCode = 'CONTEXT_MISMATCH';
    else if (message.anonymizedAt || message.retentionExpiresAt <= new Date())
      resolutionCode = 'RETENTION_EXPIRED';
    else {
      const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3 };
      const oldRank = rank[message.status ?? ''] ?? 0;
      const newRank = rank[event.status] ?? 0;
      if (
        (message.statusOccurredAt &&
          event.occurredAt < message.statusOccurredAt) ||
        (event.status === 'failed' ? oldRank >= 2 : newRank < oldRank)
      )
        resolutionCode = 'STALE_OR_CONTRADICTORY';
      else
        await tx.communicationMessage.updateMany({
          where: { id: message.id, companyId: message.companyId },
          data: {
            status: event.status,
            statusOccurredAt: event.occurredAt,
            ...(event.status === 'read' && !message.readAt
              ? { readAt: event.occurredAt }
              : {}),
          },
        });
    }
    await tx.communicationMessageStatusEvent.update({
      where: { id },
      data: { appliedAt: new Date(), resolutionCode },
    });
    if (
      resolutionCode === 'CONTEXT_NOT_FOUND' ||
      resolutionCode === 'CONTEXT_MISMATCH'
    ) {
      await tx.communicationWebhookDelivery.update({
        where: { id: event.deliveryId },
        data: { reviewRequired: true, lastErrorCode: resolutionCode },
      });
    }
    // Intent state is deliberately untouched: failed/delayed events never authorize a resend.
  }
}
