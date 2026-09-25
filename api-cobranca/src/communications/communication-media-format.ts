import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const MEDIA_MAX_BYTES = 16 * 1024 * 1024;

export interface DetectedMedia {
  contentType: string;
  family: 'image' | 'document' | 'audio';
  extension: string;
}

/** Stable local reasons stored on the attachment (never provider text). */
export type MediaFailure =
  | 'UNSUPPORTED_TYPE'
  | 'TYPE_MISMATCH'
  | 'FILE_TOO_LARGE'
  | 'PROVIDER_MEDIA_EXPIRED'
  | 'DOWNLOAD_FAILED'
  | 'STORAGE_LIMIT_REACHED'
  | 'STORAGE_FAILED'
  | 'STORAGE_MISSING'
  | 'STORAGE_CORRUPTED'
  | 'MEDIA_REFERENCE_MISSING';

function ascii(bytes: Buffer, start: number, end: number): string {
  return bytes.length >= end
    ? bytes.subarray(start, end).toString('latin1')
    : '';
}

/**
 * Type from the file signature only. HTML, SVG, video and other documents are not
 * supported and are never served as trusted content.
 */
export function detectMedia(
  bytes: Buffer,
  declared: string | null,
): DetectedMedia | null {
  const media = normalizeType(declared);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { contentType: 'image/jpeg', family: 'image', extension: 'jpg' };
  if (ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n')
    return { contentType: 'image/png', family: 'image', extension: 'png' };
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP')
    return { contentType: 'image/webp', family: 'image', extension: 'webp' };
  if (ascii(bytes, 0, 5) === '%PDF-')
    return {
      contentType: 'application/pdf',
      family: 'document',
      extension: 'pdf',
    };
  if (ascii(bytes, 0, 4) === 'OggS')
    return { contentType: 'audio/ogg', family: 'audio', extension: 'ogg' };
  if (ascii(bytes, 0, 5) === '#!AMR')
    return { contentType: 'audio/amr', family: 'audio', extension: 'amr' };
  // An MP4 container is audio only when declared as such; MP4 video is unsupported.
  if (ascii(bytes, 4, 8) === 'ftyp')
    return media?.startsWith('audio/')
      ? { contentType: 'audio/mp4', family: 'audio', extension: 'm4a' }
      : null;
  if (bytes[0] === 0xff && bytes.length > 1 && (bytes[1]! & 0xf6) === 0xf0)
    return { contentType: 'audio/aac', family: 'audio', extension: 'aac' };
  if (
    ascii(bytes, 0, 3) === 'ID3' ||
    (bytes[0] === 0xff && bytes.length > 1 && (bytes[1]! & 0xe0) === 0xe0)
  )
    return { contentType: 'audio/mpeg', family: 'audio', extension: 'mp3' };
  return null;
}

export function normalizeType(value: string | null | undefined): string | null {
  const type = value?.split(';')[0]?.trim().toLowerCase();
  return type && type !== 'application/octet-stream' ? type : null;
}

/** The declared type, when present, must agree with the signature. */
export function declaredMatches(
  detected: DetectedMedia,
  declared: string | null,
): boolean {
  const type = normalizeType(declared);
  if (!type) return true;
  if (detected.family === 'audio') return type.startsWith('audio/');
  if (detected.contentType === 'image/jpeg')
    return type === 'image/jpeg' || type === 'image/jpg';
  return type === detected.contentType;
}

const MAGIC = Buffer.from('CFMEDIA1', 'latin1');

/** AES-256-GCM, bound to the attachment id: a file moved to another attachment fails. */
export function sealMedia(
  plain: Buffer,
  key: { version: string; key: Buffer },
  attachmentId: string,
): Buffer {
  const version = Buffer.from(key.version, 'utf8');
  if (version.length < 1 || version.length > 64)
    throw new Error('MEDIA_KEY_VERSION_INVALID');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key.key, iv);
  cipher.setAAD(
    Buffer.from(`communication-media:${attachmentId}:${key.version}`),
  );
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([
    MAGIC,
    Buffer.from([version.length]),
    version,
    iv,
    cipher.getAuthTag(),
    body,
  ]);
}

export function openMedia(
  sealed: Buffer,
  keyFor: (version: string) => Buffer,
  attachmentId: string,
): Buffer {
  if (!sealed.subarray(0, MAGIC.length).equals(MAGIC))
    throw new Error('MEDIA_FORMAT_INVALID');
  const length = sealed[MAGIC.length] ?? 0;
  const versionStart = MAGIC.length + 1;
  const version = sealed
    .subarray(versionStart, versionStart + length)
    .toString('utf8');
  const ivStart = versionStart + length;
  if (!length || sealed.length < ivStart + 28)
    throw new Error('MEDIA_FORMAT_INVALID');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFor(version),
    sealed.subarray(ivStart, ivStart + 12),
  );
  decipher.setAAD(
    Buffer.from(`communication-media:${attachmentId}:${version}`),
  );
  decipher.setAuthTag(sealed.subarray(ivStart + 12, ivStart + 28));
  return Buffer.concat([
    decipher.update(sealed.subarray(ivStart + 28)),
    decipher.final(),
  ]);
}
