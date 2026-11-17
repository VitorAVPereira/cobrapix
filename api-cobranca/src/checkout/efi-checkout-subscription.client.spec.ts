import { ConfigService } from '@nestjs/config';
import EfiPay from 'sdk-node-apis-efi';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import type { CheckoutIssuerAccount } from './checkout-platform.service';
import { EfiCheckoutSubscriptionClient } from './efi-checkout-subscription.client';

jest.mock('sdk-node-apis-efi');

describe('EfiCheckoutSubscriptionClient', () => {
  const sdk = {
    createPlan: jest.fn(),
    createSubscription: jest.fn(),
    defineSubscriptionPayMethod: jest.fn(),
    detailSubscription: jest.fn(),
    cancelSubscription: jest.fn(),
  };
  const env: Record<string, string> = {
    EFI_CHARGES_WEBHOOK_BASE_URL: 'https://api.example.com',
    EFI_WEBHOOK_SECRET: 'efi_webhook_secret_with_more_than_32_chars',
  };
  const client = new EfiCheckoutSubscriptionClient(
    { decrypt: (value: string) => value } as unknown as PaymentCryptoService,
    { get: (key: string) => env[key] } as unknown as ConfigService,
  );
  const account = {
    identity: { id: 'conta-1', environment: 'HOMOLOGATION' },
    credential: {
      encryptedClientId: 'id',
      encryptedClientSecret: 'secret',
    },
  } as unknown as CheckoutIssuerAccount;
  const customer = {
    name: 'Maria Souza',
    cpf: '52998224725',
    email: 'maria@exemplo.test',
    phone_number: '11999999999',
  };
  const address = {
    street: 'Praça da Sé',
    number: '10',
    neighborhood: 'Sé',
    city: 'São Paulo',
    state: 'SP',
    zipcode: '01001000',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (EfiPay as unknown as jest.Mock).mockImplementation(() => sdk);
  });

  it('cria o plano sem fim e devolve o id da Efí', async () => {
    sdk.createPlan.mockResolvedValue({ code: 200, data: { plan_id: 1234 } });
    await expect(client.createPlan(account, 'Trimestral', 3)).resolves.toBe(
      '1234',
    );
    expect(sdk.createPlan).toHaveBeenCalledWith(
      {},
      { name: 'Trimestral', interval: 3, repeats: null },
    );
    sdk.createPlan.mockResolvedValue({ code: 200, data: {} });
    await expect(client.createPlan(account, 'Trimestral', 3)).rejects.toThrow();
  });

  it('passo 1: cria a assinatura com o id da tentativa e a URL de aviso com o token', async () => {
    sdk.createSubscription.mockResolvedValue({
      code: 200,
      data: {
        subscription_id: 11976,
        status: 'new',
        charges: [{ charge_id: 2396478, status: 'new', total: 2990 }],
      },
    });

    await expect(
      client.create(account, '1234', {
        attemptId: 'attempt-1',
        description: 'Porquim Trimestral',
        valueCents: 2990,
      }),
    ).resolves.toEqual({ subscriptionId: '11976', chargeId: '2396478' });
    const [params, body] = sdk.createSubscription.mock.calls[0] as [
      { id: number },
      {
        items: unknown[];
        metadata: { custom_id: string; notification_url: string };
      },
    ];
    expect(params).toEqual({ id: 1234 });
    expect(body.items).toEqual([
      { name: 'Porquim Trimestral', value: 2990, amount: 1 },
    ]);
    expect(body.metadata.custom_id).toBe('attempt-1');
    const url = new URL(body.metadata.notification_url);
    expect(url.pathname).toBe('/webhooks/efi/cobrancas');
    expect(url.searchParams.get('account')).toBe('conta-1');
    expect(url.searchParams.get('token')).toBe(env.EFI_WEBHOOK_SECRET);
    // The payment is a separate call: nothing about the card goes here.
    expect(JSON.stringify(body)).not.toContain('payment');
  });

  it('passo 2: cobra o cartão e lê a primeira cobrança', async () => {
    sdk.defineSubscriptionPayMethod.mockResolvedValue({
      code: 200,
      data: {
        subscription_id: 11976,
        status: 'active',
        charge: { id: 2396478, status: 'waiting', parcel: 1, total: 2990 },
        total: 2990,
        payment: 'credit_card',
      },
    });
    await expect(
      client.pay(account, '11976', {
        paymentToken: 'tok',
        customer,
        address,
      }),
    ).resolves.toEqual({
      chargeId: '2396478',
      status: 'waiting',
      totalCents: 2990,
    });
    expect(sdk.defineSubscriptionPayMethod).toHaveBeenCalledWith(
      { id: 11976 },
      {
        payment: {
          credit_card: {
            payment_token: 'tok',
            customer,
            billing_address: address,
          },
        },
      },
    );

    // An answer that says nothing about the charge is not taken as paid.
    sdk.defineSubscriptionPayMethod.mockResolvedValue({ code: 200, data: {} });
    await expect(
      client.pay(account, '11976', { paymentToken: 'tok', customer, address }),
    ).rejects.toThrow();
  });

  it('consulta: situação, id da tentativa e as cobranças do histórico', async () => {
    sdk.detailSubscription.mockResolvedValue({
      code: 200,
      data: {
        subscription_id: 11976,
        value: 2990,
        status: 'active',
        custom_id: 'attempt-1',
        history: [
          { charge_id: 2396478, status: 'paid' },
          { charge_id: 'x', status: 'new' },
        ],
      },
    });
    await expect(client.detail(account, '11976')).resolves.toEqual({
      subscriptionId: '11976',
      status: 'active',
      customId: 'attempt-1',
      valueCents: 2990,
      charges: [{ chargeId: '2396478', status: 'paid' }],
    });
    sdk.detailSubscription.mockResolvedValue({ code: 200 });
    await expect(client.detail(account, '11976')).resolves.toBeNull();
  });

  it('cancelar duas vezes não é erro; cancelamento que falhou de verdade é', async () => {
    sdk.cancelSubscription.mockResolvedValue({ code: 200 });
    await expect(client.cancel(account, '11976')).resolves.toBeUndefined();

    sdk.cancelSubscription.mockRejectedValue(new Error('socket hang up'));
    sdk.detailSubscription.mockResolvedValue({
      data: { subscription_id: 11976, status: 'canceled' },
    });
    await expect(client.cancel(account, '11976')).resolves.toBeUndefined();

    sdk.detailSubscription.mockResolvedValue({
      data: { subscription_id: 11976, status: 'active' },
    });
    await expect(client.cancel(account, '11976')).rejects.toThrow(
      'socket hang up',
    );
  });
});
