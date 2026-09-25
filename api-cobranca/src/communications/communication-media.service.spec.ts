import { ConfigService } from '@nestjs/config';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import type { WhatsappTransport } from '../whatsapp/transport/whatsapp-transport';
import { WhatsappTransportError } from '../whatsapp/transport/whatsapp-transport.error';
import {
  declaredMatches,
  detectMedia,
  openMedia,
  sealMedia,
} from './communication-media-format';
import { MediaStorage } from './communication-media-storage';
import { CommunicationMediaService } from './communication-media.service';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('synthetic image body'),
]);
const PDF = Buffer.from('%PDF-1.7\nsynthetic');
const keys = {
  PAYMENT_ENCRYPTION_KEYS: JSON.stringify({
    v1: 'a'.repeat(64),
    v2: 'b'.repeat(64),
  }),
};
const crypto = (active: string) =>
  new PaymentCryptoService(
    new ConfigService({ ...keys, PAYMENT_ACTIVE_KEY_VERSION: active }),
  );

describe('media format', () => {
  it.each([
    [Buffer.from([0xff, 0xd8, 0xff, 0xe0]), null, 'image/jpeg'],
    [PNG, 'image/png', 'image/png'],
    [Buffer.from('RIFF\0\0\0\0WEBPVP8 '), 'image/webp', 'image/webp'],
    [PDF, 'application/pdf', 'application/pdf'],
    [Buffer.from('OggS\0\x02'), 'audio/ogg; codecs=opus', 'audio/ogg'],
    [Buffer.from('#!AMR\n'), 'audio/amr', 'audio/amr'],
    [Buffer.from('\0\0\0\x20ftypM4A '), 'audio/mp4', 'audio/mp4'],
    [Buffer.from('ID3\x04\0'), 'audio/mpeg', 'audio/mpeg'],
  ])('detects %# by signature', (bytes, declared, expected) => {
    expect(detectMedia(bytes, declared)?.contentType).toBe(expected);
  });

  it.each([
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'), 'image/svg+xml'],
    [Buffer.from('<!doctype html><script>'), 'text/html'],
    [Buffer.from('\0\0\0\x20ftypisom'), 'video/mp4'],
    [Buffer.from('PK\x03\x04docx'), 'application/vnd.openxmlformats'],
  ])('rejects unsupported or active content %#', (bytes, declared) => {
    expect(detectMedia(bytes, declared)).toBeNull();
  });

  it('requires the declared type to agree with the signature', () => {
    const pdf = detectMedia(PDF, 'image/png')!;
    expect(declaredMatches(pdf, 'image/png')).toBe(false);
    expect(declaredMatches(pdf, 'application/pdf')).toBe(true);
    expect(declaredMatches(pdf, null)).toBe(true);
  });

  it('seals per attachment and still opens files written with an older key', () => {
    const old = crypto('v1').derivedKey('communication-media');
    const sealed = sealMedia(PNG, old, 'attachment-1');
    expect(sealed.includes(PNG)).toBe(false);
    const keyFor = (version: string) =>
      crypto('v2').derivedKey('communication-media', version).key;
    expect(openMedia(sealed, keyFor, 'attachment-1')).toEqual(PNG);
    expect(() => openMedia(sealed, keyFor, 'attachment-2')).toThrow();
    const tampered = Buffer.from(sealed);
    tampered.writeUInt8(
      tampered.readUInt8(tampered.length - 1) ^ 1,
      tampered.length - 1,
    );
    expect(() => openMedia(tampered, keyFor, 'attachment-1')).toThrow();
  });
});

describe('media storage', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'media-spec-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('derives keys from the server id and refuses traversal or foreign keys', () => {
    const storage = new MediaStorage(root);
    const id = randomUUID();
    expect(storage.keyFor(id)).toBe(`${id.slice(0, 2)}/${id}.bin`);
    for (const invalid of ['../etc/passwd', 'x/../../y', 'report.pdf'])
      expect(() => storage.keyFor(invalid)).toThrow('MEDIA_ID_INVALID');
    for (const key of [
      '../../etc/passwd',
      `/abs/${id}.bin`,
      `${id.slice(0, 2)}/../${id}.bin`,
      `${id.slice(0, 2)}\\${id}.bin`,
    ])
      expect(() => storage.pathOf(key)).toThrow('MEDIA_KEY_INVALID');
  });

  it('writes atomically with private permissions and removes idempotently', async () => {
    const storage = new MediaStorage(root);
    const key = storage.keyFor(randomUUID());
    await storage.write(key, Buffer.from('sealed'));
    expect(await readFile(storage.pathOf(key), 'utf8')).toBe('sealed');
    if (process.platform !== 'win32')
      expect((await stat(storage.pathOf(key))).mode & 0o777).toBe(0o600);
    await storage.remove(key);
    await storage.remove(key);
  });
});

describe('CommunicationMediaService', () => {
  const messageId = randomUUID();
  const attachmentId = randomUUID();
  const future = new Date(Date.now() + 86_400_000);
  let root: string;

  function setup(attachment: Record<string, unknown> | null = null) {
    const prisma = {
      communicationAttachment: {
        findFirst: jest.fn().mockResolvedValue(attachment),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          retentionExpiresAt: future,
          message: { anonymizedAt: null, retentionExpiresAt: future },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        aggregate: jest.fn().mockResolvedValue({ _sum: { sizeBytes: 0 } }),
      },
    };
    const transport = { downloadMedia: jest.fn() };
    const service = new CommunicationMediaService(
      prisma as unknown as PrismaService,
      new ConfigService({
        COMMUNICATION_MEDIA_DIR: root,
        COMMUNICATION_MEDIA_LIMIT_BYTES: 1024,
      }),
      crypto('v1'),
      transport as unknown as WhatsappTransport,
    );
    const read = jest.spyOn(service.storage, 'read');
    return { service, prisma, transport, read };
  }
  const claimed = (overrides: Record<string, unknown> = {}) => ({
    id: attachmentId,
    leaseToken: 'lease',
    attempts: 1,
    externalMediaId: '123',
    contentType: 'image/png',
    ...overrides,
  });
  const run = async (
    context: ReturnType<typeof setup>,
    claim: ReturnType<typeof claimed> | null,
  ) => {
    jest
      .spyOn(context.service, 'claim')
      .mockResolvedValueOnce(claim)
      .mockResolvedValue(null);
    await context.service.processPending();
    const calls = context.prisma.communicationAttachment.updateMany.mock
      .calls as Array<[{ data: Record<string, unknown> }]>;
    return calls.at(-1)?.[0].data;
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'media-service-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const stored = {
    id: attachmentId,
    state: 'READY',
    storageKey: `${attachmentId.slice(0, 2)}/${attachmentId}.bin`,
    contentType: 'image/png',
    sha256: null,
    errorCode: null,
    retentionExpiresAt: future,
    message: {
      companyId: 'company-a',
      anonymizedAt: null,
      retentionExpiresAt: future,
    },
  };

  it('stores a validated download and serves it only to its company or the admin', async () => {
    const context = setup(stored);
    context.transport.downloadMedia.mockResolvedValue({
      bytes: PNG,
      contentType: 'image/png',
    });
    expect(await run(context, claimed())).toMatchObject({
      state: 'READY',
      contentType: 'image/png',
      sizeBytes: PNG.length,
    });
    const file = await context.service.openForViewer(
      { companyId: 'company-a', role: 'COMPANY_ADMIN' },
      messageId,
      attachmentId,
    );
    expect(file).toMatchObject({
      contentType: 'image/png',
      disposition: 'inline',
    });
    expect(file.bytes).toEqual(PNG);
    await expect(
      context.service.openForViewer(
        { companyId: 'platform', role: 'PLATFORM_ADMIN' },
        messageId,
        attachmentId,
      ),
    ).resolves.toBeDefined();
  });

  it('answers 404 to another company or a mismatched message without touching storage', async () => {
    const other = setup(stored);
    await expect(
      other.service.openForViewer(
        { companyId: 'company-b', role: 'COMPANY_ADMIN' },
        messageId,
        attachmentId,
      ),
    ).rejects.toMatchObject({ status: 404 });
    const unassigned = setup({
      ...stored,
      message: { ...stored.message, companyId: null },
    });
    await expect(
      unassigned.service.openForViewer(
        { companyId: 'company-a', role: 'COMPANY_ADMIN' },
        messageId,
        attachmentId,
      ),
    ).rejects.toMatchObject({ status: 404 });
    const mismatched = setup(null);
    await expect(
      mismatched.service.openForViewer(
        { companyId: 'company-a', role: 'PLATFORM_ADMIN' },
        randomUUID(),
        attachmentId,
      ),
    ).rejects.toMatchObject({ status: 404 });
    for (const context of [other, unassigned, mismatched])
      expect(context.read).not.toHaveBeenCalled();
  });

  it.each([
    [{ state: 'PENDING' }, 409],
    [{ state: 'EXPIRED' }, 410],
    [{ retentionExpiresAt: new Date(0) }, 410],
    [
      { state: 'UNAVAILABLE', errorCode: 'FILE_TOO_LARGE', storageKey: null },
      422,
    ],
  ])(
    'explains an attachment that cannot be served %#',
    async (overrides, status) => {
      const context = setup({ ...stored, ...overrides });
      await expect(
        context.service.openForViewer(
          { companyId: 'company-a', role: 'COMPANY_ADMIN' },
          messageId,
          attachmentId,
        ),
      ).rejects.toMatchObject({ status });
      expect(context.read).not.toHaveBeenCalled();
    },
  );

  it('marks a stored path traversal as unavailable instead of reading outside the root', async () => {
    const context = setup({ ...stored, storageKey: '../../etc/passwd' });
    await expect(
      context.service.openForViewer(
        { companyId: 'company-a', role: 'COMPANY_ADMIN' },
        messageId,
        attachmentId,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it.each([
    [
      new WhatsappTransportError(
        'grande',
        'REJECTED',
        'NOT_SENT',
        undefined,
        undefined,
        undefined,
        'MEDIA_TOO_LARGE',
      ),
      'FILE_TOO_LARGE',
    ],
    [
      new WhatsappTransportError('expirada', 'REJECTED', 'NOT_SENT', 404),
      'PROVIDER_MEDIA_EXPIRED',
    ],
  ])('records a definitive download failure %#', async (error, code) => {
    const context = setup();
    context.transport.downloadMedia.mockRejectedValue(error);
    expect(await run(context, claimed())).toMatchObject({
      state: 'UNAVAILABLE',
      errorCode: code,
    });
  });

  it('retries an interrupted download with backoff, then gives up after five attempts', async () => {
    const context = setup();
    context.transport.downloadMedia.mockRejectedValue(
      new WhatsappTransportError('rede', 'TEMPORARY', 'NOT_SENT'),
    );
    const retry = await run(context, claimed({ attempts: 2 }));
    expect(retry).toMatchObject({
      state: 'PENDING',
      errorCode: 'DOWNLOAD_FAILED',
    });
    expect((retry?.nextAttemptAt as Date).getTime()).toBeGreaterThan(
      Date.now() + 50_000,
    );
    expect(await run(context, claimed({ attempts: 5 }))).toMatchObject({
      state: 'UNAVAILABLE',
      errorCode: 'DOWNLOAD_FAILED',
    });
  });

  it.each([
    [
      Buffer.from('<html><script>alert(1)</script>'),
      'application/pdf',
      'UNSUPPORTED_TYPE',
    ],
    [PDF, 'image/png', 'TYPE_MISMATCH'],
    [Buffer.alloc(2048, 0xff), 'audio/mpeg', 'STORAGE_LIMIT_REACHED'],
  ])(
    'rejects fake types and the storage limit without storing %#',
    async (bytes, declared, code) => {
      const context = setup();
      context.transport.downloadMedia.mockResolvedValue({
        bytes,
        contentType: declared,
      });
      expect(
        await run(context, claimed({ contentType: declared })),
      ).toMatchObject({ state: 'UNAVAILABLE', errorCode: code });
    },
  );
});
