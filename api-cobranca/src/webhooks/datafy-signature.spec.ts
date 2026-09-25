import { createHmac } from 'node:crypto';
import { verifyDatafySignature } from './datafy-signature';

describe('Assinatura Datafy', () => {
  const secret = 'whsec_synthetic_fixture';
  const now = 1_800_000_000_000;
  const raw = Buffer.from('{ "text": "ação", "number": 1 }\n');
  const timestamp = String(now / 1000);
  const sign = (body: Buffer, time = timestamp): string =>
    `sha256=${createHmac('sha256', secret).update(`${time}.`).update(body).digest('hex')}`;
  const valid = { secret, rawBody: raw, timestamp, signature: sign(raw), now };

  it('autentica os bytes originais incluindo espacos e acentos', () => {
    expect(verifyDatafySignature(valid)).toBe(true);
    expect(
      verifyDatafySignature({
        ...valid,
        rawBody: Buffer.from('{"text":"ação","number":1}'),
      }),
    ).toBe(false);
  });
  it.each([
    '',
    'NaN',
    'Infinity',
    '1e9',
    '1800000000.1',
    ' 1800000000',
    String(now / 1000 - 301),
    String(now / 1000 + 31),
  ])('recusa timestamp invalido: %s', (time) => {
    expect(
      verifyDatafySignature({
        ...valid,
        timestamp: time,
        signature: sign(raw, time),
      }),
    ).toBe(false);
  });
  it.each([
    '',
    'sha256=ab',
    `sha256=${'z'.repeat(64)}`,
    `sha256=${'0'.repeat(66)}`,
    ['duplicate'],
  ])('recusa assinatura malformada: %s', (signature) => {
    expect(verifyDatafySignature({ ...valid, signature })).toBe(false);
  });
  it('recusa segredo ausente/incorreto e corpo ausente sem fallback JSON', () => {
    expect(verifyDatafySignature({ ...valid, secret: '' })).toBe(false);
    expect(verifyDatafySignature({ ...valid, secret: 'whsec_other' })).toBe(
      false,
    );
    expect(verifyDatafySignature({ ...valid, rawBody: undefined })).toBe(false);
  });
});
