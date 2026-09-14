import { ConfigService } from '@nestjs/config';
import { createCipheriv } from 'crypto';
import { PaymentCryptoService } from './payment-crypto.service';

const oldKey = '11'.repeat(32);
const newKey = '22'.repeat(32);

function service(active = 'v2'): PaymentCryptoService {
  return new PaymentCryptoService(
    new ConfigService({
      PAYMENT_ENCRYPTION_KEYS: JSON.stringify({ v1: oldKey, v2: newKey }),
      PAYMENT_ACTIVE_KEY_VERSION: active,
    }),
  );
}

describe('PaymentCryptoService versioned envelopes', () => {
  it('decrypts previous versions after switching the active key', () => {
    const encrypted = service('v1').encrypt('tenant-secret');
    expect(service('v2').decrypt(encrypted)).toBe('tenant-secret');
    expect(
      JSON.parse(Buffer.from(service().encrypt('new'), 'base64').toString()),
    ).toMatchObject({ keyVersion: 'v2' });
  });

  it('uses distinct nonces and rejects tampered ciphertext', () => {
    const crypto = service();
    const first = crypto.encrypt('secret');
    expect(crypto.encrypt('secret')).not.toBe(first);
    const envelope = JSON.parse(
      Buffer.from(first, 'base64').toString(),
    ) as Record<string, string>;
    envelope.value = Buffer.from('tampered').toString('base64');
    expect(() =>
      crypto.decrypt(Buffer.from(JSON.stringify(envelope)).toString('base64')),
    ).toThrow('Dados criptografados inválidos');
  });

  it('authenticates the key version even when key bytes are reused', () => {
    const crypto = new PaymentCryptoService(
      new ConfigService({
        PAYMENT_ENCRYPTION_KEYS: JSON.stringify({ v1: oldKey, v2: oldKey }),
        PAYMENT_ACTIVE_KEY_VERSION: 'v1',
      }),
    );
    const envelope = JSON.parse(
      Buffer.from(crypto.encrypt('secret'), 'base64').toString(),
    ) as Record<string, string>;
    envelope.keyVersion = 'v2';
    expect(() =>
      crypto.decrypt(Buffer.from(JSON.stringify(envelope)).toString('base64')),
    ).toThrow();
  });

  it('retains read compatibility with legacy envelopes during rotation', () => {
    const legacySecret = oldKey;
    const cipher = createCipheriv(
      'aes-256-gcm',
      Buffer.from(legacySecret, 'hex'),
      Buffer.alloc(12, 7),
    );
    const value = Buffer.concat([cipher.update('old-secret'), cipher.final()]);
    const legacy = Buffer.from(
      JSON.stringify({
        iv: Buffer.alloc(12, 7).toString('base64'),
        authTag: cipher.getAuthTag().toString('base64'),
        value: value.toString('base64'),
      }),
    ).toString('base64');
    const crypto = new PaymentCryptoService(
      new ConfigService({
        PAYMENT_SECRET_KEY: legacySecret,
        PAYMENT_ENCRYPTION_KEYS: JSON.stringify({ v2: newKey }),
        PAYMENT_ACTIVE_KEY_VERSION: 'v2',
      }),
    );
    expect(crypto.decrypt(legacy)).toBe('old-secret');
    expect(crypto.decrypt(crypto.encrypt(crypto.decrypt(legacy)))).toBe(
      'old-secret',
    );
  });

  it.each([
    'not-json',
    JSON.stringify({ v2: 'short' }),
    JSON.stringify({ other: newKey }),
  ])('fails closed for invalid configured keyrings', (keys: string) => {
    const crypto = new PaymentCryptoService(
      new ConfigService({
        PAYMENT_ENCRYPTION_KEYS: keys,
        PAYMENT_ACTIVE_KEY_VERSION: 'v2',
        PAYMENT_SECRET_KEY: oldKey,
      }),
    );
    expect(() => crypto.encrypt('secret')).toThrow();
  });

  it('does not reveal plaintext or raw malformed input in errors', () => {
    expect(() => service().decrypt('sensitive-invalid-envelope')).toThrow(
      'Dados criptografados inválidos',
    );
  });
});
