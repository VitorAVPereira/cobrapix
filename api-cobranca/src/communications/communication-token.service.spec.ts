import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CommunicationTokenService,
  CursorScope,
  INTERACTIVE_TOKEN_PATTERN,
  interactiveTokenHash,
} from './communication-token.service';

const secret = 'synthetic-jwt-secret-with-at-least-32-characters';
const tokens = new CommunicationTokenService(
  new ConfigService({ JWT_SECRET: secret }),
);
const scope: CursorScope = {
  route: 'company-conversation-messages',
  userId: 'user-a',
  companyId: 'company-a',
  conversationId: 'conversation-1',
};
const position = { at: new Date('2026-09-24T12:00:00.000Z'), id: 'message-9' };

describe('CommunicationTokenService', () => {
  it('round-trips a cursor only within the exact scope it was issued for', () => {
    const cursor = tokens.encodeCursor(scope, position);
    expect(tokens.decodeCursor(cursor, scope)).toEqual(position);
    for (const other of [
      { ...scope, userId: 'user-b' },
      { ...scope, companyId: 'company-b' },
      { ...scope, conversationId: 'conversation-2' },
      { ...scope, route: 'admin-conversation-messages', companyId: null },
      { ...scope, filters: { channel: 'EMAIL' } },
    ])
      expect(() => tokens.decodeCursor(cursor, other)).toThrow(
        BadRequestException,
      );
  });

  it('treats omitted and undefined filters as the same scope', () => {
    const cursor = tokens.encodeCursor(scope, position);
    expect(
      tokens.decodeCursor(cursor, {
        ...scope,
        filters: { channel: undefined },
      }),
    ).toEqual(position);
  });

  it('rejects tampered, re-signed with another key and malformed cursors', () => {
    const cursor = tokens.encodeCursor(scope, position);
    const [body = '', signature = ''] = cursor.split('.');
    const forged = Buffer.from(
      JSON.stringify({
        ...(JSON.parse(Buffer.from(body, 'base64url').toString()) as object),
        i: 'message-1',
      }),
    ).toString('base64url');
    const otherKey = new CommunicationTokenService(
      new ConfigService({ JWT_SECRET: `${secret}-rotated` }),
    );
    for (const invalid of [
      `${forged}.${signature}`,
      otherKey.encodeCursor(scope, position),
      `${body}`,
      `${cursor}.extra`,
      'not-base64.%%%',
      'x'.repeat(2000),
    ])
      expect(() => tokens.decodeCursor(invalid, scope)).toThrow(
        BadRequestException,
      );
  });

  it('issues deterministic, opaque button references', () => {
    const token = tokens.interactiveToken('message-1', 0);
    expect(token).toMatch(INTERACTIVE_TOKEN_PATTERN);
    expect(tokens.interactiveToken('message-1', 0)).toBe(token);
    expect(tokens.interactiveToken('message-1', 1)).not.toBe(token);
    expect(token).not.toContain('message-1');
    expect(interactiveTokenHash(token)).toMatch(/^[a-f0-9]{64}$/);
  });
});
