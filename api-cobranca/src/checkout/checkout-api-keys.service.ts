import { createHash, randomBytes } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CheckoutApiKey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const MAX_API_KEYS = 5;
const TOUCH_EVERY_MS = 60_000;

/** Keys are random enough for a plain SHA-256; only the hash is kept. */
export function apiKeyHash(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export interface CheckoutApiCaller {
  keyId: string;
  companyId: string;
}

@Injectable()
export class CheckoutApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string) {
    const keys = await this.prisma.checkoutApiKey.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
    return keys.map((key) => this.view(key));
  }

  /** The key itself is in this answer only; it cannot be shown again. */
  async create(companyId: string, userId: string, name: string) {
    const active = await this.prisma.checkoutApiKey.count({
      where: { companyId, revokedAt: null },
    });
    if (active >= MAX_API_KEYS)
      throw new ConflictException({
        code: 'CHECKOUT_API_KEY_LIMIT',
        message: `Use no máximo ${MAX_API_KEYS} chaves ativas. Revogue uma antes de criar outra.`,
      });
    const key = `ckapi_${randomBytes(32).toString('base64url')}`;
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.checkoutApiKey.create({
        data: {
          companyId,
          name: name.trim(),
          prefix: key.slice(0, 12),
          keyHash: apiKeyHash(key),
          createdByUserId: userId,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId,
          userId,
          action: 'CHECKOUT_API_KEY_CREATED',
          entityType: 'CheckoutApiKey',
          entityId: row.id,
          changes: { name: row.name, prefix: row.prefix },
        },
      });
      return row;
    });
    return { ...this.view(created), key };
  }

  /** A revoked key stops at once and never comes back. */
  async revoke(
    companyId: string,
    userId: string,
    id: string,
    now = new Date(),
  ) {
    const key = await this.prisma.checkoutApiKey.findFirst({
      where: { id, companyId },
    });
    if (!key) throw new NotFoundException('Chave não encontrada.');
    if (key.revokedAt) return;
    await this.prisma.$transaction([
      this.prisma.checkoutApiKey.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.auditLog.create({
        data: {
          companyId,
          userId,
          action: 'CHECKOUT_API_KEY_REVOKED',
          entityType: 'CheckoutApiKey',
          entityId: id,
          changes: { name: key.name, prefix: key.prefix },
        },
      }),
    ]);
  }

  /** The caller of a key still valid for a checkout company, or null. */
  async authenticate(
    key: string,
    now = new Date(),
  ): Promise<CheckoutApiCaller | null> {
    const found = await this.prisma.checkoutApiKey.findUnique({
      where: { keyHash: apiKeyHash(key) },
      include: { company: { select: { product: true } } },
    });
    if (!found || found.revokedAt || found.company.product !== 'CHECKOUT')
      return null;
    // At most one write a minute per key, not one per request.
    if (
      !found.lastUsedAt ||
      now.getTime() - found.lastUsedAt.getTime() >= TOUCH_EVERY_MS
    )
      await this.prisma.checkoutApiKey.update({
        where: { id: found.id },
        data: { lastUsedAt: now },
      });
    return { keyId: found.id, companyId: found.companyId };
  }

  private view(key: CheckoutApiKey) {
    return {
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      revokedAt: key.revokedAt,
    };
  }
}
