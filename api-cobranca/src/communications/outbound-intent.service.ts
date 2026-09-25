import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  CommunicationOutboundIntent,
  CommunicationTransport,
  Prisma,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { AcceptedMessage } from '../whatsapp/transport/whatsapp-transport';
import { WhatsappTransportError } from '../whatsapp/transport/whatsapp-transport.error';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { CommunicationAttributionService } from './communication-attribution.service';
import {
  canonicalPayload,
  MessageContextInput,
  messageRecipient,
  MessageRecipientInput,
} from './message-context';

export interface ReserveOutboundIntentInput {
  idempotencyKey: string;
  conversationId: string;
  transport: CommunicationTransport;
  transportChannelId: string;
  recipient: MessageRecipientInput;
  context: MessageContextInput;
  content: string;
  messageType: string;
  payload: unknown;
  retentionExpiresAt: Date;
  /** Provider ID of the quoted message; covered by the request hash through the payload. */
  replyToExternalMessageId?: string | null;
}

const reservationSelect = {
  id: true,
  messageId: true,
  state: true,
  requestHash: true,
  retentionExpiresAt: true,
} satisfies Prisma.CommunicationOutboundIntentSelect;
type StoredReservation = Prisma.CommunicationOutboundIntentGetPayload<{
  select: typeof reservationSelect;
}>;
export type OutboundReservation = Omit<StoredReservation, 'requestHash'>;

/** Durable dispatch state. A lease expiring after a possible POST never permits resend. */
@Injectable()
export class OutboundIntentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PaymentCryptoService,
    private readonly attribution: CommunicationAttributionService,
  ) {}

  async reserve(
    input: ReserveOutboundIntentInput,
  ): Promise<OutboundReservation> {
    if (
      typeof input.idempotencyKey !== 'string' ||
      !input.idempotencyKey.trim() ||
      input.idempotencyKey.length > 200 ||
      !Object.values(CommunicationTransport).includes(input.transport) ||
      !/^\d{1,64}$/.test(input.transportChannelId) ||
      typeof input.content !== 'string' ||
      !input.content.trim() ||
      typeof input.messageType !== 'string' ||
      !/^[a-z_]{1,64}$/.test(input.messageType)
    ) {
      throw new BadRequestException('Intencao de envio invalida');
    }
    if (
      !(input.retentionExpiresAt instanceof Date) ||
      !Number.isFinite(input.retentionExpiresAt.getTime()) ||
      input.retentionExpiresAt <= new Date()
    ) {
      throw new BadRequestException('Retencao de envio invalida');
    }
    const recipient = messageRecipient(input.recipient);
    const payload = canonicalPayload(input.payload);
    let requestHash: string | undefined;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const conversation = await tx.communicationConversation.findUnique({
          where: { id: input.conversationId },
        });
        if (
          !conversation ||
          conversation.channel !== 'WHATSAPP' ||
          conversation.recipientHash !== recipient.hash ||
          (conversation.recipientType &&
            conversation.recipientType !== recipient.type)
        ) {
          throw new BadRequestException(
            'Destinatario nao corresponde a conversa',
          );
        }
        if (
          conversation.recipientAnonymizedAt ||
          conversation.retentionExpiresAt <= new Date()
        ) {
          throw new ConflictException('Conversa fora do periodo de retencao');
        }
        const context = await this.attribution.validateContext(
          tx,
          input.context,
          recipient,
        );
        requestHash = createHash('sha256')
          .update(
            canonicalPayload({
              conversationId: conversation.id,
              transport: input.transport,
              transportChannelId: input.transportChannelId,
              recipientType: recipient.type,
              recipientHash: recipient.hash,
              context,
              content: input.content,
              messageType: input.messageType,
              payload: JSON.parse(payload) as unknown,
            }),
          )
          .digest('hex');
        const previous = await tx.communicationOutboundIntent.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          select: reservationSelect,
        });
        if (previous) return this.existingReservation(previous, requestHash);
        const retentionExpiresAt = new Date(
          Math.min(
            input.retentionExpiresAt.getTime(),
            conversation.retentionExpiresAt.getTime(),
          ),
        );
        const message = await tx.communicationMessage.create({
          data: {
            conversationId: conversation.id,
            ...context,
            direction: 'OUTBOUND',
            status: 'pending',
            content: input.content,
            source: 'LIVE',
            transportChannelId: input.transportChannelId,
            recipientType: recipient.type,
            messageType: input.messageType,
            replyToExternalMessageId: input.replyToExternalMessageId ?? null,
            attributionMethod: context.companyId
              ? 'OUTBOUND_CONTEXT'
              : 'UNASSIGNED',
            retentionExpiresAt,
          },
          select: { id: true },
        });
        const created = await tx.communicationOutboundIntent.create({
          data: {
            idempotencyKey: input.idempotencyKey,
            messageId: message.id,
            ...context,
            transport: input.transport,
            transportChannelId: input.transportChannelId,
            recipientType: recipient.type,
            recipientHash: recipient.hash,
            recipientEncrypted: this.crypto.encrypt(recipient.value),
            requestHash,
            payloadEncrypted: this.crypto.encrypt(payload),
            retentionExpiresAt,
          },
          select: reservationSelect,
        });
        return this.existingReservation(created, requestHash);
      });
    } catch (error: unknown) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002' ||
        !requestHash
      )
        throw error;
      // The losing transaction has rolled back its message. Read only after that rollback.
      const winner = await this.prisma.communicationOutboundIntent.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: reservationSelect,
      });
      if (!winner) throw error;
      return this.existingReservation(winner, requestHash);
    }
  }

  async execute(
    id: string,
    validate: (intent: CommunicationOutboundIntent) => Promise<void>,
    transmit: (intent: CommunicationOutboundIntent) => Promise<AcceptedMessage>,
    accepted?: (
      tx: Prisma.TransactionClient,
      intent: CommunicationOutboundIntent,
      result: AcceptedMessage,
    ) => Promise<void>,
  ): Promise<AcceptedMessage> {
    const intent =
      await this.prisma.communicationOutboundIntent.findUniqueOrThrow({
        where: { id },
      });
    if (intent.state === 'ACCEPTED' && intent.externalMessageId)
      return {
        accepted: true,
        messageId: intent.externalMessageId,
        status: 'accepted',
      };
    if (intent.state !== 'PENDING')
      throw new ConflictException({
        code: 'OUTBOUND_REVIEW_REQUIRED',
        message:
          'Envio ja processado ou em andamento. Nao sera reenviado automaticamente.',
      });
    if (intent.nextAttemptAt > new Date())
      throw new WhatsappTransportError(
        'Envio aguardando limite do canal.',
        'RATE_LIMIT',
        'NOT_SENT',
        undefined,
        undefined,
        Math.ceil((intent.nextAttemptAt.getTime() - Date.now()) / 1000),
      );
    const leaseToken = randomUUID();
    const claim = await this.prisma.communicationOutboundIntent.updateMany({
      where: { id, state: 'PENDING', nextAttemptAt: { lte: new Date() } },
      data: {
        state: 'SENDING',
        leaseToken,
        leaseExpiresAt: new Date(Date.now() + 60_000),
        attempts: { increment: 1 },
      },
    });
    if (!claim.count) throw new ConflictException('Envio em andamento.');
    let transmitting = false;
    try {
      if (intent.retentionExpiresAt <= new Date())
        throw new Error('RETENTION_EXPIRED');
      await validate(intent);
      transmitting = true;
      const result = await transmit(intent);
      // The provider accepted: while this lease is held, a transient commit failure is retried, never resent.
      for (let commit = 1; ; commit++) {
        try {
          // Acceptance and message reference commit together; provider status events may arrive earlier.
          await this.prisma.$transaction(async (tx) => {
            const updated = await tx.communicationOutboundIntent.updateMany({
              // An expired lease marked uncertain is never reclaimed, so this worker's proof of acceptance still applies.
              where: {
                id,
                OR: [
                  { state: 'SENDING', leaseToken },
                  {
                    state: 'UNCERTAIN',
                    lastErrorCode: 'WORKER_LOST_AFTER_CLAIM',
                    externalMessageId: null,
                  },
                ],
              },
              data: {
                state: 'ACCEPTED',
                externalMessageId: result.messageId,
                leaseToken: null,
                leaseExpiresAt: null,
                lastErrorCode: null,
              },
            });
            if (!updated.count) throw new Error('DISPATCH_LEASE_LOST');
            await tx.communicationMessage.updateMany({
              where: { id: intent.messageId, externalMessageId: null },
              data: { externalMessageId: result.messageId },
            });
            await tx.communicationMessage.updateMany({
              where: {
                id: intent.messageId,
                OR: [
                  { status: null },
                  {
                    status: {
                      in: ['pending', 'sending', 'delivery_uncertain'],
                    },
                  },
                ],
              },
              data: { status: 'accepted' },
            });
            if (accepted) await accepted(tx, intent, result);
          });
          break;
        } catch (error: unknown) {
          if (
            commit >= 3 ||
            (error instanceof Error && error.message === 'DISPATCH_LEASE_LOST')
          )
            throw error;
          await new Promise<void>((resolve) =>
            setTimeout(resolve, 200 * commit),
          );
        }
      }
      return { ...result, status: 'accepted' };
    } catch (error: unknown) {
      const safeError = error instanceof WhatsappTransportError ? error : null;
      const retry =
        safeError?.kind === 'RATE_LIMIT' ||
        (safeError?.kind === 'TEMPORARY' && safeError.outcome === 'NOT_SENT');
      const uncertain =
        transmitting && (!safeError || safeError.outcome === 'UNCERTAIN');
      const state = uncertain ? 'UNCERTAIN' : retry ? 'PENDING' : 'FAILED';
      const wait =
        safeError?.retryAfterSeconds ??
        Math.min(3600, 5 * 2 ** Math.min(intent.attempts, 10));
      // Only local, stable codes are stored: a transport reason or a coded validation error.
      const reasonCode =
        safeError?.reasonCode ??
        (error instanceof Error && /^[A-Z][A-Z_]{2,63}$/.test(error.message)
          ? error.message
          : undefined);
      try {
        await this.prisma.$transaction(async (tx) => {
          const changed = await tx.communicationOutboundIntent.updateMany({
            where: { id, state: 'SENDING', leaseToken },
            data: {
              state,
              lastErrorCode: uncertain
                ? 'DELIVERY_UNCERTAIN'
                : retry
                  ? 'WAITING_FOR_CHANNEL'
                  : (reasonCode ?? 'DISPATCH_REJECTED'),
              nextAttemptAt: new Date(Date.now() + wait * 1000),
              leaseToken: null,
              leaseExpiresAt: null,
            },
          });
          if (changed.count)
            await tx.communicationMessage.updateMany({
              where: { id: intent.messageId, externalMessageId: null },
              data: {
                status:
                  state === 'UNCERTAIN'
                    ? 'delivery_uncertain'
                    : state === 'PENDING'
                      ? 'pending'
                      : 'failed',
              },
            });
        });
      } catch {
        /* The durable SENDING claim is recovered as UNCERTAIN, never resent. */
      }
      if (uncertain)
        throw new WhatsappTransportError(
          'Resultado do envio incerto. Consulte a triagem administrativa.',
          'UNCERTAIN',
          'UNCERTAIN',
        );
      throw error;
    }
  }

  async recover(): Promise<Array<{ id: string; attempts: number }>> {
    await this.prisma.$transaction(async (tx) => {
      const expired = await tx.communicationOutboundIntent.findMany({
        where: { state: 'SENDING', leaseExpiresAt: { lt: new Date() } },
        take: 100,
        select: { id: true, messageId: true },
      });
      for (const item of expired) {
        const changed = await tx.communicationOutboundIntent.updateMany({
          where: {
            id: item.id,
            state: 'SENDING',
            leaseExpiresAt: { lt: new Date() },
          },
          data: {
            state: 'UNCERTAIN',
            lastErrorCode: 'WORKER_LOST_AFTER_CLAIM',
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
        if (changed.count)
          await tx.communicationMessage.updateMany({
            where: { id: item.messageId, externalMessageId: null },
            data: { status: 'delivery_uncertain' },
          });
      }
    });
    return this.prisma.communicationOutboundIntent.findMany({
      where: { state: 'PENDING', nextAttemptAt: { lte: new Date() } },
      orderBy: { nextAttemptAt: 'asc' },
      take: 100,
      select: { id: true, attempts: true },
    });
  }

  private existingReservation(
    record: StoredReservation,
    requestHash: string,
  ): OutboundReservation {
    if (record.requestHash !== requestHash)
      throw new ConflictException(
        'Chave de envio ja utilizada com outro conteudo ou contexto',
      );
    if (record.retentionExpiresAt <= new Date())
      throw new ConflictException('Intencao fora do periodo de retencao');
    return {
      id: record.id,
      messageId: record.messageId,
      state: record.state,
      retentionExpiresAt: record.retentionExpiresAt,
    };
  }
}
