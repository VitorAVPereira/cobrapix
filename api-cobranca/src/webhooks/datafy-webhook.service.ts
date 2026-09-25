import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { DatafyWebhookQueue } from '../queue/datafy-webhook.queue';
import { normalizeDatafyEvents } from './datafy-event.types';
import { verifyDatafySignature } from './datafy-signature';
import { DatafyEventProcessor } from './datafy-event-processor.service';

const DAY = 86_400_000;
const MAX_ATTEMPTS = 5;
const adminSelect = {
  id: true,
  state: true,
  attempts: true,
  eventKinds: true,
  reviewRequired: true,
  lastErrorCode: true,
  nextAttemptAt: true,
  processedAt: true,
  retentionExpiresAt: true,
  payloadPurgedAt: true,
  replayCount: true,
  lastReplayedAt: true,
  createdAt: true,
} satisfies Prisma.CommunicationWebhookDeliverySelect;
export interface DatafyHeaders {
  deliveryId: unknown;
  signature: unknown;
  timestamp: unknown;
}

@Injectable()
export class DatafyWebhookService {
  private readonly logger = new Logger(DatafyWebhookService.name);
  private recovering = false;
  private readonly processor: DatafyEventProcessor;
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly crypto: PaymentCryptoService,
    private readonly queue: DatafyWebhookQueue,
  ) {
    this.processor = new DatafyEventProcessor(crypto);
  }

  async receive(
    rawBody: Buffer | undefined,
    headers: DatafyHeaders,
  ): Promise<{ received: true }> {
    // During a secret rotation the previous secret is accepted until it is removed.
    const secrets = [
      this.config.get<string>('DATAFY_WEBHOOK_SECRET'),
      this.config.get<string>('DATAFY_WEBHOOK_SECRET_PREVIOUS'),
    ].filter((secret): secret is string => Boolean(secret));
    if (
      !secrets.some((secret) =>
        verifyDatafySignature({
          secret,
          rawBody,
          timestamp: headers.timestamp,
          signature: headers.signature,
        }),
      )
    )
      throw new UnauthorizedException('Assinatura Datafy invalida');
    if (!rawBody || rawBody.length > 1024 * 1024)
      throw new BadRequestException('Corpo Datafy invalido');
    if (
      typeof headers.deliveryId !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
        headers.deliveryId,
      )
    )
      throw new BadRequestException('Identificador Datafy invalido');
    const wabaId = this.config.get<string>('META_BUSINESS_ACCOUNT_ID');
    const phoneNumberId = this.config.get<string>('META_PHONE_NUMBER_ID');
    if (!wabaId || !phoneNumberId)
      throw new ServiceUnavailableException('Canal Datafy nao configurado');
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as unknown;
    } catch {
      throw new BadRequestException('JSON Datafy invalido');
    }
    const events = normalizeDatafyEvents(payload, { wabaId, phoneNumberId });
    const bodyHash = createHash('sha256').update(rawBody).digest('hex');
    const deliveryId = headers.deliveryId.toLowerCase();
    let stored: { id: string; attempts: number };
    try {
      stored = await this.deadline(
        this.prisma.communicationWebhookDelivery.create({
          data: {
            channel: 'WHATSAPP',
            transport: 'DATAFY',
            transportChannelId: phoneNumberId,
            wabaId,
            deliveryId,
            bodyHash,
            payloadEncrypted: this.crypto.encrypt(rawBody.toString('utf8')),
            retentionExpiresAt: new Date(Date.now() + 7 * DAY),
            eventKinds: [...new Set(events.map((event) => event.kind))],
            reviewRequired: events.some(
              (event) => event.kind !== 'MESSAGE' && event.kind !== 'STATUS',
            ),
          },
          select: { id: true, attempts: true },
        }),
        8000,
      );
    } catch (error: unknown) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      )
        throw new ServiceUnavailableException(
          'Recebimento Datafy indisponivel',
        );
      const previous = await this.deadline(
        this.prisma.communicationWebhookDelivery.findUnique({
          where: {
            transport_transportChannelId_deliveryId: {
              transport: 'DATAFY',
              transportChannelId: phoneNumberId,
              deliveryId,
            },
          },
          select: { id: true, attempts: true, bodyHash: true },
        }),
        3000,
      ).catch(() => {
        throw new ServiceUnavailableException(
          'Recebimento Datafy indisponivel',
        );
      });
      if (!previous || previous.bodyHash !== bodyHash)
        throw new ConflictException('Entrega Datafy com conteudo divergente');
      stored = previous;
    }
    // Bounded best effort after commit. The periodic database sweep is the durable outbox.
    await this.publish(stored.id, stored.attempts);
    return { received: true };
  }

  async processDelivery(id: string): Promise<void> {
    const now = new Date(),
      token = randomUUID();
    const claimed = await this.prisma.communicationWebhookDelivery.updateMany({
      where: {
        id,
        transport: 'DATAFY',
        attempts: { lt: MAX_ATTEMPTS },
        payloadEncrypted: { not: null },
        OR: [
          { state: 'PENDING', nextAttemptAt: { lte: now } },
          { state: 'PROCESSING', leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        state: 'PROCESSING',
        leaseToken: token,
        leaseExpiresAt: new Date(now.getTime() + 60_000),
        attempts: { increment: 1 },
      },
    });
    if (!claimed.count) return;
    try {
      await this.prisma.$transaction(
        async (tx) => {
          const active = await tx.communicationWebhookDelivery.updateMany({
            where: {
              id,
              state: 'PROCESSING',
              leaseToken: token,
              leaseExpiresAt: { gt: new Date() },
            },
            data: { leaseToken: token },
          });
          if (!active.count) return;
          const delivery =
            await tx.communicationWebhookDelivery.findUniqueOrThrow({
              where: { id },
            });
          if (!delivery.payloadEncrypted || !delivery.wabaId)
            throw new Error('INVALID_DELIVERY_CONTEXT');
          const payload: unknown = JSON.parse(
            this.crypto.decrypt(delivery.payloadEncrypted),
          );
          const events = normalizeDatafyEvents(payload, {
            wabaId: delivery.wabaId,
            phoneNumberId: delivery.transportChannelId,
          });
          const review = await this.processor.apply(
            tx,
            events,
            id,
            delivery.transportChannelId,
            delivery.replayCount > 0,
          );
          await tx.communicationWebhookDelivery.updateMany({
            where: { id, leaseToken: token },
            data: {
              state: 'PROCESSED',
              processedAt: new Date(),
              leaseToken: null,
              leaseExpiresAt: null,
              reviewRequired: review,
              lastErrorCode: review ? 'REVIEW_REQUIRED' : null,
              retentionExpiresAt: new Date(Date.now() + 7 * DAY),
            },
          });
        },
        { timeout: 10_000, maxWait: 2000 },
      );
    } catch {
      const delivery = await this.prisma.communicationWebhookDelivery.findFirst(
        { where: { id, leaseToken: token }, select: { attempts: true } },
      );
      if (!delivery) return;
      const terminal = delivery.attempts >= MAX_ATTEMPTS;
      await this.prisma.communicationWebhookDelivery.updateMany({
        where: { id, leaseToken: token },
        data: {
          state: terminal ? 'FAILED' : 'PENDING',
          leaseToken: null,
          leaseExpiresAt: null,
          reviewRequired: terminal,
          lastErrorCode: terminal ? 'PROCESSING_EXHAUSTED' : 'PROCESSING_RETRY',
          nextAttemptAt: new Date(
            Date.now() + 5000 * 2 ** (delivery.attempts - 1),
          ),
        },
      });
      if (!terminal) throw new Error('DATAFY_PROCESSING_RETRY');
    }
  }

  @Interval(30_000)
  async recover(): Promise<void> {
    if (this.recovering) return;
    this.recovering = true;
    try {
      const now = new Date();
      await this.prisma.communicationWebhookDelivery.updateMany({
        where: {
          transport: 'DATAFY',
          state: { in: ['PENDING', 'PROCESSING'] },
          attempts: { gte: MAX_ATTEMPTS },
          OR: [{ state: 'PENDING' }, { leaseExpiresAt: { lt: now } }],
        },
        data: {
          state: 'FAILED',
          leaseToken: null,
          leaseExpiresAt: null,
          reviewRequired: true,
          lastErrorCode: 'PROCESSING_EXHAUSTED',
        },
      });
      const deliveries =
        await this.prisma.communicationWebhookDelivery.findMany({
          where: {
            transport: 'DATAFY',
            attempts: { lt: MAX_ATTEMPTS },
            payloadEncrypted: { not: null },
            OR: [
              { state: 'PENDING', nextAttemptAt: { lte: now } },
              { state: 'PROCESSING', leaseExpiresAt: { lt: now } },
            ],
          },
          orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
          take: 100,
          select: { id: true, attempts: true, replayCount: true },
        });
      await Promise.all(
        deliveries.map((delivery) =>
          this.publish(delivery.id, delivery.attempts, delivery.replayCount),
        ),
      );
      await this.reconcileStatuses();
      await this.purgeProcessedPayloads();
    } catch {
      this.logger.warn('DATAFY_RECOVERY_DEFERRED');
    } finally {
      this.recovering = false;
    }
  }

  async reconcileStatuses(): Promise<void> {
    const events = await this.prisma.communicationMessageStatusEvent.findMany({
      where: { appliedAt: null, nextAttemptAt: { lte: new Date() } },
      orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
      take: 100,
      select: { id: true },
    });
    for (const event of events)
      await this.prisma.$transaction(
        (tx) => this.processor.reconcileStatus(tx, event.id),
        { timeout: 5000, maxWait: 1000 },
      );
  }

  async purgeProcessedPayloads(): Promise<void> {
    await this.prisma.communicationWebhookDelivery.updateMany({
      where: {
        transport: 'DATAFY',
        state: 'PROCESSED',
        reviewRequired: false,
        retentionExpiresAt: { lte: new Date() },
        payloadEncrypted: { not: null },
        statusEvents: { none: { appliedAt: null } },
      },
      data: { payloadEncrypted: null, payloadPurgedAt: new Date() },
    });
  }

  async listForAdmin(
    userId: string,
    query: { cursor?: string; limit?: number } = {},
  ): Promise<unknown> {
    await this.assertAdmin(userId);
    const limit = query.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new BadRequestException('Limite de pagina invalido');
    const rows = await this.prisma.communicationWebhookDelivery.findMany({
      where: {
        transport: 'DATAFY',
        OR: [
          { state: { in: ['FAILED', 'PENDING', 'PROCESSING'] } },
          { reviewRequired: true },
          { statusEvents: { some: { appliedAt: null } } },
        ],
      },
      select: {
        ...adminSelect,
        _count: { select: { statusEvents: { where: { appliedAt: null } } } },
        statusEvents: {
          select: {
            status: true,
            occurredAt: true,
            errorCodes: true,
            resolutionCode: true,
          },
          orderBy: { occurredAt: 'desc' },
          take: 20,
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const items = rows.slice(0, limit);
    return {
      items,
      nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async replayForAdmin(id: string, userId: string): Promise<{ queued: true }> {
    await this.assertAdmin(userId);
    const updated = await this.prisma.communicationWebhookDelivery.updateMany({
      where: {
        id,
        transport: 'DATAFY',
        payloadEncrypted: { not: null },
        OR: [{ state: 'FAILED' }, { state: 'PROCESSED', reviewRequired: true }],
      },
      data: {
        state: 'PENDING',
        attempts: 0,
        leaseToken: null,
        leaseExpiresAt: null,
        nextAttemptAt: new Date(),
        replayCount: { increment: 1 },
        lastReplayedAt: new Date(),
        lastReplayActorId: userId,
      },
    });
    if (!updated.count)
      throw new ConflictException('Entrega indisponivel para reprocessamento');
    const replay =
      await this.prisma.communicationWebhookDelivery.findUniqueOrThrow({
        where: { id },
        select: { replayCount: true },
      });
    await this.publish(id, 0, replay.replayCount);
    return { queued: true };
  }

  private async assertAdmin(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (user?.role !== 'PLATFORM_ADMIN')
      throw new ForbiddenException('Acesso restrito ao administrador');
  }
  private async publish(
    id: string,
    attempt: number,
    generation = 0,
  ): Promise<void> {
    try {
      await this.deadline(this.queue.enqueue(id, attempt, generation), 250);
    } catch {
      this.logger.warn('DATAFY_ENQUEUE_DEFERRED');
    }
  }
  private async deadline<T>(
    promise: Promise<T>,
    milliseconds: number,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('DATAFY_TIMEOUT')),
            milliseconds,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
