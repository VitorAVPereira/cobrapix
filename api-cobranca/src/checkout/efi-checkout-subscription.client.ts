import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import EfiPay from 'sdk-node-apis-efi';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { cardNotificationUrl } from '../payment/efi-card.client';
import type { CheckoutIssuerAccount } from './checkout-platform.service';
import type {
  CheckoutCardAddress,
  CheckoutCardCustomer,
} from './efi-checkout-card.client';

/** The first charge of a subscription, as the Efí answered the payment. */
export interface SubscriptionPayment {
  chargeId: string;
  status: string;
  totalCents: number | null;
}

/** What the Efí says about a subscription, read back by its id. */
export interface EfiSubscriptionDetail {
  subscriptionId: string;
  // new, active, new_charge, canceled or expired.
  status: string;
  customId: string | null;
  valueCents: number | null;
  charges: Array<{ chargeId: string; status: string }>;
}

// The calls used here; the SDK typings do not expose all of them.
interface SubscriptionSdk {
  createPlan(params: object, body: unknown): Promise<unknown>;
  createSubscription(params: { id: number }, body: unknown): Promise<unknown>;
  defineSubscriptionPayMethod(
    params: { id: number },
    body: unknown,
  ): Promise<unknown>;
  detailSubscription(params: { id: number }): Promise<unknown>;
  cancelSubscription(params: { id: number }): Promise<unknown>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Efí ids come as numbers or digits; anything else is no id. */
function idOf(value: unknown): string {
  const id =
    typeof value === 'number' || typeof value === 'string' ? String(value) : '';
  return /^\d{1,20}$/.test(id) ? id : '';
}

const cents = (value: unknown): number | null =>
  Number.isSafeInteger(value) ? Number(value) : null;

/**
 * Recurring card subscriptions (API Cobranças) on the account the checkout
 * issues from. A subscription is created in two steps, so its id is known
 * before any money moves and a lost answer can be read back. Never card data.
 */
@Injectable()
export class EfiCheckoutSubscriptionClient {
  constructor(
    private readonly crypto: PaymentCryptoService,
    private readonly config: ConfigService,
  ) {}

  /** A plan that charges every `intervalMonths`, with no end. */
  async createPlan(
    account: CheckoutIssuerAccount,
    name: string,
    intervalMonths: number,
  ): Promise<string> {
    const data = record(
      record(
        await this.sdk(account).createPlan(
          {},
          { name: name.slice(0, 255), interval: intervalMonths, repeats: null },
        ),
      )?.data,
    );
    const planId = idOf(data?.plan_id);
    if (!planId) throw new Error('EFI_PLAN_WITHOUT_ID');
    return planId;
  }

  /** Step 1: the subscription and its first charge exist; nothing is charged. */
  async create(
    account: CheckoutIssuerAccount,
    planId: string,
    input: { attemptId: string; description: string; valueCents: number },
  ): Promise<{ subscriptionId: string; chargeId: string | null }> {
    const notificationUrl = cardNotificationUrl(
      this.config,
      account.identity.id,
    );
    if (!notificationUrl)
      throw new ConflictException({
        code: 'CARD_NOT_AVAILABLE',
        message: 'O cartão está indisponível no momento.',
      });
    const data = record(
      record(
        await this.sdk(account).createSubscription(
          { id: Number(planId) },
          {
            items: [
              {
                name: input.description.slice(0, 255),
                value: input.valueCents,
                amount: 1,
              },
            ],
            metadata: {
              custom_id: input.attemptId,
              notification_url: notificationUrl,
            },
          },
        ),
      )?.data,
    );
    const subscriptionId = idOf(data?.subscription_id);
    if (!subscriptionId) throw new Error('EFI_SUBSCRIPTION_WITHOUT_ID');
    const charges = Array.isArray(data?.charges) ? data.charges : [];
    return {
      subscriptionId,
      chargeId: idOf(record(charges[0])?.charge_id) || null,
    };
  }

  /** Step 2: the card is charged for the first cycle. */
  async pay(
    account: CheckoutIssuerAccount,
    subscriptionId: string,
    input: {
      paymentToken: string;
      customer: CheckoutCardCustomer;
      address: CheckoutCardAddress;
    },
  ): Promise<SubscriptionPayment> {
    const data = record(
      record(
        await this.sdk(account).defineSubscriptionPayMethod(
          { id: Number(subscriptionId) },
          {
            payment: {
              credit_card: {
                payment_token: input.paymentToken,
                customer: input.customer,
                billing_address: input.address,
              },
            },
          },
        ),
      )?.data,
    );
    const charge = record(data?.charge);
    const chargeId = idOf(charge?.id);
    if (!chargeId || typeof charge?.status !== 'string')
      throw new Error('EFI_SUBSCRIPTION_PAYMENT_UNREADABLE');
    return {
      chargeId,
      status: charge.status,
      totalCents: cents(charge.total) ?? cents(data?.total),
    };
  }

  async detail(
    account: CheckoutIssuerAccount,
    subscriptionId: string,
  ): Promise<EfiSubscriptionDetail | null> {
    const data = record(
      record(
        await this.sdk(account).detailSubscription({
          id: Number(subscriptionId),
        }),
      )?.data,
    );
    if (!data) return null;
    const history = Array.isArray(data.history) ? data.history : [];
    return {
      subscriptionId: idOf(data.subscription_id),
      status: typeof data.status === 'string' ? data.status : '',
      customId: typeof data.custom_id === 'string' ? data.custom_id : null,
      valueCents: cents(data.value),
      charges: history
        .map(record)
        .map((row) => ({
          chargeId: idOf(row?.charge_id),
          status: typeof row?.status === 'string' ? row.status : '',
        }))
        .filter((row) => row.chargeId),
    };
  }

  /** Stops future charges. Canceling twice is not an error for the caller. */
  async cancel(
    account: CheckoutIssuerAccount,
    subscriptionId: string,
  ): Promise<void> {
    try {
      await this.sdk(account).cancelSubscription({
        id: Number(subscriptionId),
      });
    } catch (error) {
      // The answer may have been lost, or it was canceled before: what
      // counts is that the Efí no longer charges it.
      const current = await this.detail(account, subscriptionId).catch(
        () => null,
      );
      if (current?.status !== 'canceled') throw error;
    }
  }

  private sdk(account: CheckoutIssuerAccount): SubscriptionSdk {
    return new EfiPay({
      sandbox: account.identity.environment !== 'PRODUCTION',
      client_id: this.crypto.decrypt(account.credential.encryptedClientId),
      client_secret: this.crypto.decrypt(
        account.credential.encryptedClientSecret,
      ),
      cache: false,
    }) as unknown as SubscriptionSdk;
  }
}
