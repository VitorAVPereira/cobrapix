import { PaymentCryptoService } from './payment-crypto.service';

export function rotateEncryptedFields<T extends Record<string, string | null>>(
  fields: T,
  crypto: PaymentCryptoService,
): { fields: T; changed: boolean } {
  const result: T = { ...fields };
  let changed = false;
  for (const name of Object.keys(fields) as Array<keyof T>) {
    const encrypted = fields[name];
    if (encrypted === null) continue;
    const plaintext = crypto.decrypt(encrypted);
    if (crypto.getEnvelopeKeyVersion(encrypted) === crypto.activeKeyVersion)
      continue;
    result[name] = crypto.encrypt(plaintext) as T[keyof T];
    changed = true;
  }
  return { fields: result, changed };
}
