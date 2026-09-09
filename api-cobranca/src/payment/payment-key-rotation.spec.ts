import { ConfigService } from '@nestjs/config';
import { PaymentCryptoService } from './payment-crypto.service';
import { rotateEncryptedFields } from './payment-key-rotation';

describe('payment key rotation', () => {
  const keys = JSON.stringify({ v1: '11'.repeat(32), v2: '22'.repeat(32) });
  const oldCrypto = new PaymentCryptoService(
    new ConfigService({
      PAYMENT_ENCRYPTION_KEYS: keys,
      PAYMENT_ACTIVE_KEY_VERSION: 'v1',
    }),
  );
  const crypto = new PaymentCryptoService(
    new ConfigService({
      PAYMENT_ENCRYPTION_KEYS: keys,
      PAYMENT_ACTIVE_KEY_VERSION: 'v2',
    }),
  );

  it('re-encrypts only outdated non-null values without changing their contents', () => {
    const current = crypto.encrypt('current');
    const result = rotateEncryptedFields(
      { client: oldCrypto.encrypt('secret'), certificate: null, current },
      crypto,
    );
    expect(result.changed).toBe(true);
    expect(result.fields.certificate).toBeNull();
    expect(result.fields.current).toBe(current);
    expect(crypto.getEnvelopeKeyVersion(result.fields.client)).toBe('v2');
    expect(crypto.decrypt(result.fields.client)).toBe('secret');
  });

  it('does not rewrite a record that has already been rotated', () => {
    const fields = { secret: crypto.encrypt('secret') };
    expect(rotateEncryptedFields(fields, crypto)).toEqual({
      fields,
      changed: false,
    });
  });

  it('rejects corrupted data instead of committing a partial rotation', () => {
    expect(() =>
      rotateEncryptedFields(
        { first: oldCrypto.encrypt('first'), second: 'corrupted' },
        crypto,
      ),
    ).toThrow('Dados criptografados inválidos');
  });
});
