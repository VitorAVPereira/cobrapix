import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalPayload } from './message-context';

/** Everything a cursor is valid for. A cursor replayed under another scope is rejected. */
export interface CursorScope {
  route: string;
  userId: string;
  companyId: string | null;
  conversationId?: string;
  filters?: Record<string, unknown>;
}

export interface CursorPosition {
  at: Date;
  id: string;
}

export const INTERACTIVE_TOKEN_PATTERN = /^cfm1\.[A-Za-z0-9_-]{43}$/;

export function interactiveTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Opaque tokens for communications: pagination cursors and button references. */
@Injectable()
export class CommunicationTokenService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    // Domain-separated from the session signature; rotating JWT_SECRET only invalidates open cursors.
    this.key = createHmac('sha256', config.getOrThrow<string>('JWT_SECRET'))
      .update('ciframais:communications:v1')
      .digest();
  }

  /** Deterministic per message/button, so a retried reservation reuses the same reference. */
  interactiveToken(messageId: string, buttonIndex: number): string {
    return `cfm1.${this.mac(`interactive:${messageId}:${buttonIndex}`)}`;
  }

  encodeCursor(scope: CursorScope, position: CursorPosition): string {
    const body = Buffer.from(
      JSON.stringify({
        a: position.at.toISOString(),
        i: position.id,
        s: this.scopeHash(scope),
      }),
    ).toString('base64url');
    return `${body}.${this.mac(`cursor:${body}`)}`;
  }

  decodeCursor(token: string, scope: CursorScope): CursorPosition {
    const invalid = new BadRequestException('Cursor invalido.');
    const [body, signature, extra] = token.split('.');
    if (!body || !signature || extra !== undefined || token.length > 1024)
      throw invalid;
    const expected = Buffer.from(this.mac(`cursor:${body}`));
    const received = Buffer.from(signature);
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    )
      throw invalid;
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      throw invalid;
    }
    const value = parsed as { a?: unknown; i?: unknown; s?: unknown };
    const at = typeof value.a === 'string' ? new Date(value.a) : null;
    if (
      !at ||
      !Number.isFinite(at.getTime()) ||
      typeof value.i !== 'string' ||
      value.s !== this.scopeHash(scope)
    )
      throw invalid;
    return { at, id: value.i };
  }

  private scopeHash(scope: CursorScope): string {
    return createHash('sha256')
      .update(
        canonicalPayload({
          route: scope.route,
          userId: scope.userId,
          companyId: scope.companyId,
          conversationId: scope.conversationId ?? null,
          // Omitted filters and undefined filters are the same scope.
          filters: JSON.parse(JSON.stringify(scope.filters ?? {})) as unknown,
        }),
      )
      .digest('base64url');
  }

  private mac(value: string): string {
    return createHmac('sha256', this.key).update(value).digest('base64url');
  }
}
