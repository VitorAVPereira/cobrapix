import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import EfiPay from 'sdk-node-apis-efi';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import {
  CardSubmission,
  normalizeCardInstallments,
  normalizeCardSubmission,
} from '../payment/efi-card.client';
import type { CheckoutPlatformAccount } from './checkout-platform.service';

export type CheckoutCardBrand = 'visa' | 'mastercard' | 'amex' | 'elo';

export interface CheckoutCardCustomer {
  name: string;
  cpf: string;
  email: string;
  phone_number: string;
  juridical_person?: { corporate_name: string; cnpj: string };
}

export interface CheckoutCardAddress {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zipcode: string;
  complement?: string;
}

export interface CheckoutCardCharge {
  attemptId: string;
  description: string;
  submissionCents: number;
  installments: number;
  paymentToken: string;
  customer: CheckoutCardCustomer;
  address: CheckoutCardAddress;
}

/** What the Efí says about one card charge, read back by its id. */
export interface CheckoutCardDetail {
  chargeId: string;
  customId: string | null;
  status: string;
  method: string | null;
  installments: number | null;
  totalCents: number | null;
}

// The calls used here; the SDK typings do not expose all of them.
interface CardSdk {
  getInstallments(params: { total: number; brand: string }): Promise<unknown>;
  createOneStepCharge(params: object, body: unknown): Promise<unknown>;
  detailCharge(params: { id: string }): Promise<unknown>;
  listCharges(params: Record<string, string>): Promise<unknown>;
  getNotification(params: { token: string }): Promise<unknown>;
}

/**
 * Card notices of the CifraMais account arrive on the charges webhook with
 * the platform identity as account; null when the base URL is not usable.
 */
export function checkoutCardNotificationUrl(
  config: ConfigService,
  identityId: string,
): string | null {
  let url: URL;
  try {
    url = new URL(config.get<string>('EFI_CHARGES_WEBHOOK_BASE_URL') ?? '');
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    return null;
  return `${url.origin}/webhooks/efi/cobrancas?account=${encodeURIComponent(identityId)}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Efí charge ids come as numbers or digits; anything else is no id. */
function idOf(value: unknown): string {
  return typeof value === 'number' || typeof value === 'string'
    ? String(value)
    : '';
}

/** Card charges (API Cobranças) on the CifraMais account. Never card data. */
@Injectable()
export class EfiCheckoutCardClient {
  constructor(
    private readonly crypto: PaymentCryptoService,
    private readonly config: ConfigService,
  ) {}

  /** Installment value the Efí charges for this total, brand and count. */
  async installmentValue(
    account: CheckoutPlatformAccount,
    totalCents: number,
    brand: CheckoutCardBrand,
    installments: number,
  ): Promise<number | null> {
    const rows = normalizeCardInstallments(
      await this.sdk(account).getInstallments({ total: totalCents, brand }),
    );
    return (
      rows.find((row) => row.installments === installments)?.valueCents ?? null
    );
  }

  async installmentCounts(
    account: CheckoutPlatformAccount,
    totalCents: number,
    brand: CheckoutCardBrand,
  ): Promise<number[]> {
    const rows = normalizeCardInstallments(
      await this.sdk(account).getInstallments({ total: totalCents, brand }),
    );
    return rows.map((row) => row.installments);
  }

  async submit(
    account: CheckoutPlatformAccount,
    charge: CheckoutCardCharge,
  ): Promise<CardSubmission> {
    const notificationUrl = checkoutCardNotificationUrl(
      this.config,
      account.identity.id,
    );
    if (!notificationUrl)
      throw new ConflictException({
        code: 'CARD_NOT_AVAILABLE',
        message: 'O cartão está indisponível no momento. Pague com Pix.',
      });
    // No split: the whole sale belongs to the CifraMais account.
    const body = {
      items: [
        {
          name: charge.description.slice(0, 255),
          value: charge.submissionCents,
          amount: 1,
        },
      ],
      metadata: {
        custom_id: charge.attemptId,
        notification_url: notificationUrl,
      },
      payment: {
        credit_card: {
          installments: charge.installments,
          payment_token: charge.paymentToken,
          customer: charge.customer,
          billing_address: charge.address,
        },
      },
    };
    return normalizeCardSubmission(
      await this.sdk(account).createOneStepCharge({}, body),
    );
  }

  async detail(
    account: CheckoutPlatformAccount,
    chargeId: string,
  ): Promise<CheckoutCardDetail | null> {
    const data = record(
      record(await this.sdk(account).detailCharge({ id: chargeId }))?.data,
    );
    if (!data) return null;
    const payment = record(data.payment);
    const card = record(payment?.credit_card);
    const installments = Number(card?.installments);
    const value = Number(card?.installment_value);
    const total =
      Number.isSafeInteger(installments) && Number.isSafeInteger(value)
        ? installments * value
        : Number.isSafeInteger(data.total)
          ? Number(data.total)
          : null;
    return {
      chargeId: idOf(data.charge_id),
      customId: typeof data.custom_id === 'string' ? data.custom_id : null,
      status: typeof data.status === 'string' ? data.status : '',
      method: typeof payment?.method === 'string' ? payment.method : null,
      installments: Number.isSafeInteger(installments) ? installments : null,
      totalCents: total,
    };
  }

  /** Charge ids the Efí holds for this attempt (custom_id), around its date. */
  async findByAttempt(
    account: CheckoutPlatformAccount,
    attemptId: string,
    createdAt: Date,
    now = new Date(),
  ): Promise<string[]> {
    const listing = record(
      await this.sdk(account).listCharges({
        charge_type: 'card',
        begin_date: new Date(createdAt.getTime() - 86_400_000)
          .toISOString()
          .slice(0, 10),
        end_date: now.toISOString().slice(0, 10),
        custom_id: attemptId,
      }),
    );
    const rows = Array.isArray(listing?.data) ? listing.data : [];
    return rows
      .map(record)
      .filter((row) => row?.custom_id === attemptId)
      .map((row) => idOf(row?.charge_id ?? row?.id))
      .filter((id) => /^\d{1,20}$/.test(id));
  }

  /** The last event of a notification: which charge it is about. */
  async notification(
    account: CheckoutPlatformAccount,
    token: string,
  ): Promise<{ customId: string | null; chargeId: string | null } | null> {
    const body = record(await this.sdk(account).getNotification({ token }));
    const events = Array.isArray(body?.data) ? body.data : [];
    const last = record(events.at(-1));
    if (!last) return null;
    const identifiers = record(last.identifiers);
    const chargeId = identifiers?.charge_id;
    return {
      customId: typeof last.custom_id === 'string' ? last.custom_id : null,
      chargeId:
        typeof chargeId === 'number' || typeof chargeId === 'string'
          ? String(chargeId)
          : null,
    };
  }

  private sdk(account: CheckoutPlatformAccount): CardSdk {
    return new EfiPay({
      sandbox: account.identity.environment !== 'PRODUCTION',
      client_id: this.crypto.decrypt(account.credential.encryptedClientId),
      client_secret: this.crypto.decrypt(
        account.credential.encryptedClientSecret,
      ),
      cache: false,
    }) as unknown as CardSdk;
  }
}
