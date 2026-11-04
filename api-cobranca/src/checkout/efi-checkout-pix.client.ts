import { Injectable } from '@nestjs/common';
import EfiPay from 'sdk-node-apis-efi';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { classifyEfiError } from '../financial-activation/financial-validation.types';
import type { CheckoutPlatformAccount } from './checkout-platform.service';

export interface ImmediatePixInput {
  txid: string;
  amountCents: number;
  buyerName: string;
  buyerDocument: string;
  pixKey: string;
  description: string;
}

export type PixCreation =
  | { outcome: 'CREATED'; pixCopyPaste: string; qrCodeImage: string | null }
  // The Efí refused the request: no Pix exists for this txid.
  | { outcome: 'REJECTED'; code: string }
  // The answer was lost: the Pix may exist and is checked later by txid.
  | { outcome: 'UNCERTAIN' };

export interface PixStatus {
  status: string;
  paidAmountCents: number | null;
  endToEndId: string | null;
}

const reais = (cents: number) => (cents / 100).toFixed(2);
const cents = (value: unknown) =>
  typeof value === 'string' && /^\d+(\.\d{1,2})?$/.test(value)
    ? Math.round(Number(value) * 100)
    : null;

// The three calls used here; the SDK typings do not expose all of them.
interface PixSdk {
  pixCreateCharge(params: { txid: string }, body: unknown): Promise<unknown>;
  pixGenerateQRCode(params: { id: number }): Promise<unknown>;
  pixDetailCharge(params: { txid: string }): Promise<unknown>;
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as Record<string, unknown>;
  return (
    Number(record.status) === 404 ||
    (typeof record.nome === 'string' && record.nome.includes('nao_encontrad'))
  );
}

/** Immediate Pix (cob) on the CifraMais account, with normalized answers. */
@Injectable()
export class EfiCheckoutPixClient {
  constructor(private readonly crypto: PaymentCryptoService) {}

  async create(
    account: CheckoutPlatformAccount,
    input: ImmediatePixInput,
  ): Promise<PixCreation> {
    const sdk = this.sdk(account);
    const document = input.buyerDocument;
    const body = {
      calendario: { expiracao: 1800 },
      devedor: {
        ...(document.length === 11 ? { cpf: document } : { cnpj: document }),
        nome: input.buyerName.slice(0, 200),
      },
      valor: { original: reais(input.amountCents) },
      chave: input.pixKey,
      solicitacaoPagador: input.description.slice(0, 140),
    };
    let created: { pixCopiaECola?: string; loc?: { id?: number } };
    try {
      // PUT /v2/cob/:txid: the txid is ours, so the webhook can route it.
      created = (await sdk.pixCreateCharge(
        { txid: input.txid },
        body,
      )) as typeof created;
    } catch (error) {
      const classified = classifyEfiError(error);
      return classified.transient
        ? { outcome: 'UNCERTAIN' }
        : { outcome: 'REJECTED', code: classified.code };
    }
    let qrCodeImage: string | null = null;
    let pixCopyPaste = created.pixCopiaECola ?? '';
    if (created.loc?.id) {
      try {
        const qr = (await sdk.pixGenerateQRCode({ id: created.loc.id })) as {
          qrcode?: string;
          imagemQrcode?: string;
        };
        qrCodeImage = qr.imagemQrcode ?? null;
        pixCopyPaste = qr.qrcode ?? pixCopyPaste;
      } catch {
        // The copy-and-paste code is enough to pay; the image is a convenience.
      }
    }
    return { outcome: 'CREATED', pixCopyPaste, qrCodeImage };
  }

  /** null when the Efí has no Pix with this txid. */
  async status(
    account: CheckoutPlatformAccount,
    txid: string,
  ): Promise<PixStatus | null> {
    let detail: {
      status?: string;
      pix?: Array<{ valor?: string; endToEndId?: string }>;
    };
    try {
      detail = (await this.sdk(account).pixDetailCharge({
        txid,
      })) as typeof detail;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    const payment = detail.pix?.[0];
    return {
      status: detail.status ?? 'DESCONHECIDO',
      paidAmountCents: cents(payment?.valor),
      endToEndId: payment?.endToEndId ?? null,
    };
  }

  private sdk(account: CheckoutPlatformAccount): PixSdk {
    const sdk = new EfiPay({
      sandbox: account.identity.environment !== 'PRODUCTION',
      client_id: this.crypto.decrypt(account.credential.encryptedClientId),
      client_secret: this.crypto.decrypt(
        account.credential.encryptedClientSecret,
      ),
      certificate: this.crypto.decrypt(account.credential.encryptedCertificate),
      cert_base64: true,
      cache: false,
    });
    return sdk as unknown as PixSdk;
  }
}
