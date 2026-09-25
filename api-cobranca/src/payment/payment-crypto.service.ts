import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from 'crypto';

interface EncryptedPayload {
  keyVersion?: string;
  iv: string;
  authTag: string;
  value: string;
}

@Injectable()
export class PaymentCryptoService {
  private readonly algorithm = 'aes-256-gcm';

  constructor(private readonly config: ConfigService) {}

  get activeKeyVersion(): string {
    if (!this.config.get<string>('PAYMENT_ENCRYPTION_KEYS')) {
      if (this.config.get<string>('PAYMENT_ACTIVE_KEY_VERSION')) {
        throw new Error('Mapa de chaves de pagamento não configurado');
      }
      return 'legacy';
    }
    const version = this.config.get<string>('PAYMENT_ACTIVE_KEY_VERSION');
    if (
      !version ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(version) ||
      version === 'legacy'
    ) {
      throw new Error('Versão ativa da chave de pagamento inválida');
    }
    return version;
  }

  encrypt(value: string): string {
    const keyVersion = this.activeKeyVersion;
    const iv = randomBytes(12);
    const cipher = createCipheriv(this.algorithm, this.getKey(keyVersion), iv);
    cipher.setAAD(Buffer.from(`payment:${keyVersion}`, 'utf8'));
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);

    const payload: EncryptedPayload = {
      keyVersion,
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      value: encrypted.toString('base64'),
    };

    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  }

  decrypt(value: string): string {
    try {
      const payload = this.parseEnvelope(value);
      const decipher = createDecipheriv(
        this.algorithm,
        this.getKey(payload.keyVersion ?? 'legacy'),
        Buffer.from(payload.iv, 'base64'),
      );
      if (payload.keyVersion)
        decipher.setAAD(Buffer.from(`payment:${payload.keyVersion}`, 'utf8'));
      decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(payload.value, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new Error('Dados criptografados inválidos');
    }
  }

  /**
   * Purpose-bound 256-bit key (HKDF) from a configured key version, for data stored
   * outside this envelope (e.g. files). Never the raw payment key.
   */
  derivedKey(
    purpose: string,
    version: string = this.activeKeyVersion,
  ): { version: string; key: Buffer } {
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(purpose))
      throw new Error('Finalidade de chave inválida');
    return {
      version,
      key: Buffer.from(
        hkdfSync(
          'sha256',
          this.getKey(version),
          Buffer.alloc(0),
          `ciframais:${purpose}:${version}`,
          32,
        ),
      ),
    };
  }

  getEnvelopeKeyVersion(value: string): string {
    return this.parseEnvelope(value).keyVersion ?? 'legacy';
  }

  private parseEnvelope(value: string): EncryptedPayload {
    try {
      const parsed: unknown = JSON.parse(
        Buffer.from(value, 'base64').toString('utf8'),
      );
      if (typeof parsed !== 'object' || parsed === null) throw new Error();
      const payload = parsed as Record<string, unknown>;
      if (
        typeof payload.iv !== 'string' ||
        typeof payload.authTag !== 'string' ||
        typeof payload.value !== 'string' ||
        (payload.keyVersion !== undefined &&
          (typeof payload.keyVersion !== 'string' ||
            !/^[a-zA-Z0-9_-]{1,64}$/.test(payload.keyVersion))) ||
        Buffer.from(payload.iv, 'base64').length !== 12 ||
        Buffer.from(payload.authTag, 'base64').length !== 16
      )
        throw new Error();
      return {
        keyVersion: payload.keyVersion,
        iv: payload.iv,
        authTag: payload.authTag,
        value: payload.value,
      };
    } catch {
      throw new Error('Dados criptografados inválidos');
    }
  }

  private getKey(version: string): Buffer {
    if (version === 'legacy') return this.getLegacyKey();
    try {
      const keys: unknown = JSON.parse(
        this.config.get<string>('PAYMENT_ENCRYPTION_KEYS') ?? 'null',
      );
      if (typeof keys !== 'object' || keys === null || Array.isArray(keys))
        throw new Error();
      const map = keys as Record<string, unknown>;
      for (const [keyVersion, secret] of Object.entries(map)) {
        if (
          !/^[a-zA-Z0-9_-]{1,64}$/.test(keyVersion) ||
          keyVersion === 'legacy' ||
          typeof secret !== 'string'
        )
          throw new Error();
        this.decodeKey(secret);
      }
      if (!Object.hasOwn(map, version) || typeof map[version] !== 'string')
        throw new Error();
      return this.decodeKey(map[version]);
    } catch {
      throw new Error('Configuração das chaves de pagamento inválida');
    }
  }

  private decodeKey(secret: string): Buffer {
    if (/^[a-f0-9]{64}$/i.test(secret)) return Buffer.from(secret, 'hex');
    const decoded = Buffer.from(secret, 'base64');
    if (decoded.length !== 32 || decoded.toString('base64') !== secret)
      throw new Error();
    return decoded;
  }

  private getLegacyKey(): Buffer {
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
