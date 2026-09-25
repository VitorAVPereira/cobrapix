import {
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { UserRole } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { WHATSAPP_TRANSPORT } from '../whatsapp/transport/whatsapp-transport';
import type { WhatsappTransport } from '../whatsapp/transport/whatsapp-transport';
import { WhatsappTransportError } from '../whatsapp/transport/whatsapp-transport.error';
import {
  declaredMatches,
  detectMedia,
  MEDIA_MAX_BYTES,
  MediaFailure,
  openMedia,
  sealMedia,
} from './communication-media-format';
import { MediaStorage } from './communication-media-storage';

const KEY_PURPOSE = 'communication-media';
const MAX_ATTEMPTS = 5;
const LEASE_MS = 2 * 60_000;
const BATCH = 10;
export const DEFAULT_MEDIA_LIMIT_BYTES = 5 * 1024 ** 3;
export const MEDIA_ALERT_RATIO = 0.8;

export function mediaRoot(config: ConfigService): string {
  return (
    config.get<string>('COMMUNICATION_MEDIA_DIR')?.trim() ||
    (config.get<string>('NODE_ENV') === 'production'
      ? '/var/lib/ciframais/communication-media'
      : join(tmpdir(), 'ciframais-communication-media'))
  );
}

export function mediaLimitBytes(config: ConfigService): number {
  const configured = Number(config.get('COMMUNICATION_MEDIA_LIMIT_BYTES'));
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_MEDIA_LIMIT_BYTES;
}

export interface MediaViewer {
  companyId: string;
  role: UserRole;
}

export interface OpenedMedia {
  bytes: Buffer;
  contentType: string;
  fileName: string;
  disposition: 'inline' | 'attachment';
}

interface Claimed {
  id: string;
  leaseToken: string;
  attempts: number;
  externalMediaId: string | null;
  contentType: string | null;
}

/**
 * Downloads inbound media outside the webhook transaction, stores it encrypted in a
 * private directory and serves it only to the owning company or the platform team.
 * Every failure affects the attachment alone; the message is always kept.
 */
@Injectable()
export class CommunicationMediaService {
  private readonly logger = new Logger(CommunicationMediaService.name);
  readonly storage: MediaStorage;
  private readonly limitBytes: number;
  private processing = false;
  private purging = false;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    private readonly crypto: PaymentCryptoService,
    @Inject(WHATSAPP_TRANSPORT) private readonly transport: WhatsappTransport,
  ) {
    this.storage = new MediaStorage(mediaRoot(config));
    this.limitBytes = mediaLimitBytes(config);
  }

  @Interval(15_000)
  async processPending(): Promise<number> {
    if (this.processing) return 0;
    this.processing = true;
    let processed = 0;
    try {
      for (; processed < BATCH; processed++) {
        const claimed = await this.claim();
        if (!claimed) break;
        await this.fetchOne(claimed);
      }
    } catch {
      this.logger.warn('COMMUNICATION_MEDIA_PROCESSING_DEFERRED');
    } finally {
      this.processing = false;
    }
    return processed;
  }

  /** One pending attachment per call; the row lock and lease keep other processes out. */
  async claim(): Promise<Claimed | null> {
    const leaseToken = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const [row] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "CommunicationAttachment"
        WHERE "state" = 'PENDING' AND "nextAttemptAt" <= ${now}
          AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < ${now})
        ORDER BY "nextAttemptAt", "id" LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!row) return null;
      const claimed = await tx.communicationAttachment.update({
        where: { id: row.id },
        data: {
          leaseToken,
          leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
          attempts: { increment: 1 },
        },
        select: {
          id: true,
          attempts: true,
          externalMediaId: true,
          contentType: true,
        },
      });
      return { ...claimed, leaseToken };
    });
  }

  private async fetchOne(claimed: Claimed): Promise<void> {
    const attachment =
      await this.prisma.communicationAttachment.findUniqueOrThrow({
        where: { id: claimed.id },
        select: {
          retentionExpiresAt: true,
          message: { select: { anonymizedAt: true, retentionExpiresAt: true } },
        },
      });
    if (
      attachment.retentionExpiresAt <= new Date() ||
      attachment.message.anonymizedAt ||
      attachment.message.retentionExpiresAt <= new Date()
    )
      return this.finish(claimed, { state: 'EXPIRED' });
    if (!claimed.externalMediaId)
      return this.fail(claimed, 'MEDIA_REFERENCE_MISSING');
    let downloaded: { bytes: Buffer; contentType: string };
    try {
      downloaded = await this.transport.downloadMedia(claimed.externalMediaId);
    } catch (error: unknown) {
      if (error instanceof WhatsappTransportError) {
        if (error.reasonCode === 'MEDIA_TOO_LARGE')
          return this.fail(claimed, 'FILE_TOO_LARGE');
        if (error.providerStatus === 404 || error.providerStatus === 410)
          return this.fail(claimed, 'PROVIDER_MEDIA_EXPIRED');
      }
      // Interrupted or temporarily refused: retried with backoff, then unavailable.
      return this.retryOrFail(claimed, 'DOWNLOAD_FAILED');
    }
    if (downloaded.bytes.length > MEDIA_MAX_BYTES)
      return this.fail(claimed, 'FILE_TOO_LARGE');
    const declared = claimed.contentType ?? downloaded.contentType;
    const detected = detectMedia(downloaded.bytes, declared);
    if (!detected) return this.fail(claimed, 'UNSUPPORTED_TYPE');
    if (
      !declaredMatches(detected, claimed.contentType) ||
      !declaredMatches(detected, downloaded.contentType)
    )
      return this.fail(claimed, 'TYPE_MISMATCH');
    const { usedBytes } = await this.usage();
    if (usedBytes + downloaded.bytes.length > this.limitBytes) {
      this.logger.warn('COMMUNICATION_MEDIA_STORAGE_LIMIT_REACHED');
      return this.fail(claimed, 'STORAGE_LIMIT_REACHED');
    }
    const key = this.storage.keyFor(claimed.id);
    try {
      await this.storage.write(
        key,
        sealMedia(
          downloaded.bytes,
          this.crypto.derivedKey(KEY_PURPOSE),
          claimed.id,
        ),
      );
    } catch {
      return this.retryOrFail(claimed, 'STORAGE_FAILED');
    }
    await this.finish(claimed, {
      state: 'READY',
      storageKey: key,
      contentType: detected.contentType,
      sizeBytes: downloaded.bytes.length,
      sha256: createHash('sha256').update(downloaded.bytes).digest('hex'),
      storedAt: new Date(),
      errorCode: null,
    });
    if (
      usedBytes + downloaded.bytes.length >=
      this.limitBytes * MEDIA_ALERT_RATIO
    )
      this.logger.warn('COMMUNICATION_MEDIA_STORAGE_80_PERCENT');
  }

  private fail(claimed: Claimed, code: MediaFailure): Promise<void> {
    return this.finish(claimed, { state: 'UNAVAILABLE', errorCode: code });
  }

  private retryOrFail(claimed: Claimed, code: MediaFailure): Promise<void> {
    if (claimed.attempts >= MAX_ATTEMPTS) return this.fail(claimed, code);
    const wait = Math.min(3600, 30 * 2 ** (claimed.attempts - 1)) * 1000;
    return this.finish(claimed, {
      state: 'PENDING',
      errorCode: code,
      nextAttemptAt: new Date(Date.now() + wait),
    });
  }

  /** Compare-and-set on the lease: a worker that lost it never overwrites the result. */
  private async finish(
    claimed: Claimed,
    data: {
      state: 'PENDING' | 'READY' | 'UNAVAILABLE' | 'EXPIRED';
      errorCode?: string | null;
      nextAttemptAt?: Date;
      storageKey?: string;
      contentType?: string;
      sizeBytes?: number;
      sha256?: string;
      storedAt?: Date;
    },
  ): Promise<void> {
    await this.prisma.communicationAttachment.updateMany({
      where: { id: claimed.id, leaseToken: claimed.leaseToken },
      data: { ...data, leaseToken: null, leaseExpiresAt: null },
    });
  }

  /** Authorization first: a foreign or mismatched attachment never reaches the store. */
  async openForViewer(
    viewer: MediaViewer,
    messageId: string,
    attachmentId: string,
  ): Promise<OpenedMedia> {
    const attachment = await this.prisma.communicationAttachment.findFirst({
      where: { id: attachmentId, messageId },
      select: {
        id: true,
        state: true,
        storageKey: true,
        contentType: true,
        sha256: true,
        errorCode: true,
        retentionExpiresAt: true,
        message: {
          select: {
            companyId: true,
            anonymizedAt: true,
            retentionExpiresAt: true,
          },
        },
      },
    });
    const allowed =
      attachment &&
      (viewer.role === 'PLATFORM_ADMIN' ||
        (attachment.message.companyId !== null &&
          attachment.message.companyId === viewer.companyId));
    if (!allowed) throw new NotFoundException('Anexo não encontrado.');
    if (
      attachment.state === 'EXPIRED' ||
      attachment.retentionExpiresAt <= new Date() ||
      attachment.message.anonymizedAt ||
      attachment.message.retentionExpiresAt <= new Date()
    )
      throw new GoneException('Anexo expirado pelo prazo de retenção.');
    if (attachment.state === 'PENDING')
      throw new ConflictException({
        code: 'ATTACHMENT_PENDING',
        message: 'Anexo ainda em processamento.',
      });
    if (
      attachment.state !== 'READY' ||
      !attachment.storageKey ||
      !attachment.contentType
    )
      throw this.unavailable(attachment.errorCode);
    let bytes: Buffer;
    try {
      bytes = openMedia(
        await this.storage.read(attachment.storageKey),
        (version) => this.crypto.derivedKey(KEY_PURPOSE, version).key,
        attachment.id,
      );
    } catch (error: unknown) {
      const code =
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'STORAGE_MISSING'
          : 'STORAGE_CORRUPTED';
      await this.prisma.communicationAttachment.updateMany({
        where: { id: attachment.id, state: 'READY' },
        data: { state: 'UNAVAILABLE', errorCode: code },
      });
      this.logger.warn(`COMMUNICATION_MEDIA_${code}`);
      throw this.unavailable(code);
    }
    const detected = detectMedia(bytes, attachment.contentType);
    if (
      !detected ||
      detected.contentType !== attachment.contentType ||
      (attachment.sha256 &&
        createHash('sha256').update(bytes).digest('hex') !== attachment.sha256)
    )
      throw this.unavailable('STORAGE_CORRUPTED');
    return {
      bytes,
      contentType: detected.contentType,
      fileName: `anexo-${attachment.id.slice(0, 8)}.${detected.extension}`,
      // PDF viewers can run scripts: always download, never render inline.
      disposition: detected.family === 'document' ? 'attachment' : 'inline',
    };
  }

  private unavailable(code: string | null): UnprocessableEntityException {
    return new UnprocessableEntityException({
      code: code ?? 'ATTACHMENT_UNAVAILABLE',
      message: 'Anexo indisponível.',
    });
  }

  /** Removes files whose retention ended; the message and its metadata are kept. */
  @Interval(60 * 60_000)
  async purgeExpired(): Promise<number> {
    if (this.purging) return 0;
    this.purging = true;
    let purged = 0;
    try {
      for (;;) {
        const expired = await this.prisma.communicationAttachment.findMany({
          where: {
            retentionExpiresAt: { lte: new Date() },
            state: { not: 'EXPIRED' },
          },
          select: { id: true, storageKey: true },
          orderBy: { id: 'asc' },
          take: 200,
        });
        for (const item of expired) {
          if (item.storageKey) await this.storage.remove(item.storageKey);
          await this.prisma.communicationAttachment.updateMany({
            where: { id: item.id, state: { not: 'EXPIRED' } },
            data: {
              state: 'EXPIRED',
              storageKey: null,
              leaseToken: null,
              leaseExpiresAt: null,
            },
          });
          purged++;
        }
        if (expired.length < 200) break;
      }
    } catch {
      this.logger.warn('COMMUNICATION_MEDIA_PURGE_DEFERRED');
    } finally {
      this.purging = false;
    }
    return purged;
  }

  async usage(): Promise<{ usedBytes: number; limitBytes: number }> {
    const result = await this.prisma.communicationAttachment.aggregate({
      where: { state: 'READY' },
      _sum: { sizeBytes: true },
    });
    return {
      usedBytes: result._sum.sizeBytes ?? 0,
      limitBytes: this.limitBytes,
    };
  }
}
