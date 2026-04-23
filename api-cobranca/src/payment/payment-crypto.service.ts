import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

interface EncryptedPayload {
  iv: string;
  authTag: string;
  value: string;
}

@Injectable()
export class PaymentCryptoService {
  private readonly algorithm = 'aes-256-gcm';

  constructor(private readonly config: ConfigService) {}

  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(this.algorithm, this.getKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);

    const payload: EncryptedPayload = {
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      value: encrypted.toString('base64'),
    };

    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  }

  decrypt(value: string): string {
    const payload = JSON.parse(
      Buffer.from(value, 'base64').toString('utf8'),
    ) as EncryptedPayload;
    const decipher = createDecipheriv(
      this.algorithm,
      this.getKey(),
      Buffer.from(payload.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(payload.value, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  private getKey(): Buffer {
    const secret = this.config.get<string>('PAYMENT_SECRET_KEY');

    if (!secret) {
      throw new Error('PAYMENT_SECRET_KEY nao configurada');
    }

    if (/^[a-f0-9]{64}$/i.test(secret)) {
      return Buffer.from(secret, 'hex');
    }

    const base64 = Buffer.from(secret, 'base64');
    if (base64.length === 32) {
      return base64;
    }

    return createHash('sha256').update(secret).digest();
  }
}
