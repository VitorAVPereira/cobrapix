import { Injectable } from '@nestjs/common';
import EfiPay from 'sdk-node-apis-efi';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { classifyEfiError } from '../financial-activation/financial-validation.types';
import type { CheckoutIssuerAccount } from './checkout-platform.service';

export type RefundOutcome =
  // The money went back.
  | { outcome: 'DONE' }
  // Accepted; the Efí confirms later (notice or query).
  | { outcome: 'PROCESSING' }
  // A certain refusal: nothing was returned, the request stays open.
  | { outcome: 'REJECTED'; code: string }
  // The answer was lost: read back, never sent again.
  | { outcome: 'UNCERTAIN' };

// The calls used here; the SDK typings do not expose all of them.
interface RefundSdk {
  pixDevolution(
    params: { e2eId: string; id: string },
    body: { valor: string },
  ): Promise<unknown>;
  pixDetailDevolution(params: { e2eId: string; id: string }): Promise<unknown>;
  refundCard(
    params: { id: number },
    body: { amount: number },
  ): Promise<unknown>;
}

const reais = (cents: number) => (cents / 100).toFixed(2);

function pixOutcome(answer: unknown): RefundOutcome {
  const status =
    typeof answer === 'object' && answer !== null
      ? (answer as Record<string, unknown>).status
      : undefined;
  if (status === 'DEVOLVIDO') return { outcome: 'DONE' };
  if (status === 'NAO_REALIZADO')
    return { outcome: 'REJECTED', code: 'EFI_REFUND_NOT_DONE' };
  if (status === 'EM_PROCESSAMENTO') return { outcome: 'PROCESSING' };
  // An answer that does not say what happened proves nothing.
  return { outcome: 'UNCERTAIN' };
}

function failed(error: unknown): RefundOutcome {
  const classified = classifyEfiError(error);
  return classified.transient
    ? { outcome: 'UNCERTAIN' }
    : { outcome: 'REJECTED', code: classified.code };
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as Record<string, unknown>;
  return (
    Number(record.status) === 404 ||
    (typeof record.nome === 'string' && record.nome.includes('nao_encontrad'))
  );
}

/**
 * Money back to the buyer, from the account that received it: a Pix refund
 * (id chosen here, so a repeated call is refused) or a card refund.
 */
@Injectable()
export class EfiCheckoutRefundClient {
  constructor(private readonly crypto: PaymentCryptoService) {}

  async pix(
    account: CheckoutIssuerAccount,
    endToEndId: string,
    refundId: string,
    amountCents: number,
  ): Promise<RefundOutcome> {
    try {
      return pixOutcome(
        await this.sdk(account, true).pixDevolution(
          { e2eId: endToEndId, id: refundId },
          { valor: reais(amountCents) },
        ),
      );
    } catch (error) {
      return failed(error);
    }
  }

  /** null when the Efí has no refund with this id: it never happened. */
  async pixStatus(
    account: CheckoutIssuerAccount,
    endToEndId: string,
    refundId: string,
  ): Promise<RefundOutcome | null> {
    try {
      return pixOutcome(
        await this.sdk(account, true).pixDetailDevolution({
          e2eId: endToEndId,
          id: refundId,
        }),
      );
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async card(
    account: CheckoutIssuerAccount,
    chargeId: string,
    amountCents: number,
  ): Promise<RefundOutcome> {
    try {
      await this.sdk(account, false).refundCard(
        { id: Number(chargeId) },
        { amount: amountCents },
      );
      return { outcome: 'PROCESSING' };
    } catch (error) {
      return failed(error);
    }
  }

  private sdk(account: CheckoutIssuerAccount, pix: boolean): RefundSdk {
    return new EfiPay({
      sandbox: account.identity.environment !== 'PRODUCTION',
      client_id: this.crypto.decrypt(account.credential.encryptedClientId),
      client_secret: this.crypto.decrypt(
        account.credential.encryptedClientSecret,
      ),
      // The Pix API asks for the certificate; the Cobranças API does not.
      ...(pix
        ? {
            certificate: this.crypto.decrypt(
              account.credential.encryptedCertificate,
            ),
            cert_base64: true,
          }
        : {}),
      cache: false,
    }) as unknown as RefundSdk;
  }
}
