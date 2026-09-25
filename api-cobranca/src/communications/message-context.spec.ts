import { createHash } from 'node:crypto';
import {
  messageRecipient,
  canonicalPayload,
  normalizeMessageContext,
} from './message-context';

describe('Identidade e contexto de comunicacoes', () => {
  it('preserva o hash de telefone legado e nao inclui o transporte', () => {
    expect(
      messageRecipient({ type: 'PHONE', value: '+55 (11) 99999-9999' }),
    ).toEqual({
      type: 'PHONE',
      value: '5511999999999',
      hash: createHash('sha256').update('5511999999999').digest('hex'),
    });
  });

  it('preserva BSUID opaco e o separa de telefone com os mesmos digitos', () => {
    const opaque = messageRecipient({
      type: 'BSUID',
      value: 'US.5511999999999',
    });
    expect(opaque.value).toBe('US.5511999999999');
    expect(opaque.hash).not.toBe(
      messageRecipient({ type: 'PHONE', value: '5511999999999' }).hash,
    );
    expect(
      messageRecipient({ type: 'BSUID', value: '5511999999999' }).hash,
    ).not.toBe(
      messageRecipient({ type: 'PHONE', value: '5511999999999' }).hash,
    );
  });

  it.each(['US.5511999999999', 'texto 5511999999999', '123'])(
    'nao transforma identificador invalido em telefone: %s',
    (value: string) => {
      expect(() => messageRecipient({ type: 'PHONE', value })).toThrow();
    },
  );

  it('normaliza somente ausencia de contexto, sem inventar empresa', () => {
    expect(normalizeMessageContext({})).toEqual({
      companyId: null,
      invoiceId: null,
      debtorId: null,
    });
    expect(() => normalizeMessageContext({ invoiceId: 'invoice-1' })).toThrow();
    expect(() =>
      normalizeMessageContext({ companyId: '', debtorId: 'debtor-1' }),
    ).toThrow();
  });

  it('gera fingerprint estavel para objetos, preservando ordem de arrays', () => {
    expect(canonicalPayload({ b: [2, 1], a: { z: true, c: null } })).toBe(
      '{"a":{"c":null,"z":true},"b":[2,1]}',
    );
    expect(canonicalPayload({ a: 1, b: 2 })).toBe(
      canonicalPayload({ b: 2, a: 1 }),
    );
    expect(canonicalPayload([1, 2])).not.toBe(canonicalPayload([2, 1]));
    expect(() => canonicalPayload({ invalid: Number.NaN })).toThrow();
  });

  it('recusa valores que JSON descartaria ou converteria silenciosamente', () => {
    for (const value of [
      undefined,
      Infinity,
      new Date(),
      { missing: undefined },
      [undefined],
      new Array<unknown>(1),
      1n,
    ]) {
      expect(() => canonicalPayload(value)).toThrow();
    }
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => canonicalPayload(circular)).toThrow();
    const shared = { valid: true };
    expect(canonicalPayload([shared, shared])).toBe(
      '[{"valid":true},{"valid":true}]',
    );
  });
});
