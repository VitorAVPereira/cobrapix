import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, unlink } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY =
  /^[0-9a-f]{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.bin$/;

/**
 * Private file store under one root. Keys derive from the server-generated attachment
 * id; a stored key is revalidated and must resolve inside the root before any access.
 */
export class MediaStorage {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  keyFor(attachmentId: string): string {
    if (!UUID.test(attachmentId)) throw new Error('MEDIA_ID_INVALID');
    return `${attachmentId.slice(0, 2)}/${attachmentId}.bin`;
  }

  pathOf(key: string): string {
    if (!KEY.test(key)) throw new Error('MEDIA_KEY_INVALID');
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error('MEDIA_KEY_INVALID');
    return full;
  }

  /** Atomic: a crash leaves either the old file or none, never a partial one. */
  async write(key: string, data: Buffer): Promise<void> {
    const full = this.pathOf(key);
    await mkdir(dirname(full), { recursive: true, mode: 0o700 });
    const temporary = `${full}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(data);
      await handle.datasync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, full);
    } catch (error: unknown) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  read(key: string): Promise<Buffer> {
    return readFile(this.pathOf(key));
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(this.pathOf(key));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
