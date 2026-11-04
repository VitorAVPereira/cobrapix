import { PrismaService } from '../prisma/prisma.service';
import type { CheckoutCatalogService } from './checkout-catalog.service';
import type { CheckoutPlatformService } from './checkout-platform.service';
import type { CheckoutOrdersService } from './checkout-orders.service';
import type { CheckoutPaymentsService } from './checkout-payments.service';
import type { CheckoutWebhooksService } from './checkout-webhooks.service';
import type { EfiCheckoutCardClient } from './efi-checkout-card.client';
import type { PaymentCryptoService } from '../payment/payment-crypto.service';
import { CheckoutCardService, cartFingerprint } from './checkout-card.service';

const now = new Date('2026-11-08T12:00:00Z');
const items = [
  {
    kind: 'MAIN' as const,
    productId: 'p1',
    bumpId: null,
    name: 'Porquim Anual',
    unitPriceCents: 10000,
    discountCents: 0,
    deliveryMode: 'ACCESS_LINK' as const,
    accessUrl: 'https://acesso.test',
    accessInstructions: null,
    accessPeriodMonths: 12,
  },
];
const fingerprint = cartFingerprint({
  productId: 'p1',
  items,
  couponId: null,
  subtotalCents: 10000,
});
const card = {
  account: {
    settings: { id: 'ps-2', cardCreditDays: 30 },
    identity: { id: 'identity-cifra', environment: 'HOMOLOGATION' },
  },
  rates: {
    receipt: 'ANTICIPATED' as const,
    cashBasisPoints: 300,
    anticipationBasisPoints: 100,
  },
  creditDays: 30,
  payeeCode: 'payee-cifra',
};
const option = {
  installments: 1,
  installmentValueCents: 10310,
  submissionCents: 10310,
  totalCents: 10310,
  efiFeeCents: 310,
};
const address = {
  street: 'Rua A',
  number: '10',
  neighborhood: 'Centro',
  city: 'São Paulo',
  state: 'SP' as const,
  zipcode: '01001-000',
};
const orderDto = {
  bumpIds: [],
  couponCode: null,
  buyer: {
    name: 'Maria Souza',
    email: 'maria@exemplo.test',
    document: '529.982.247-25',
    phone: '11999999999',
  },
  quoteId: 'quote-1',
  installments: 1,
  paymentToken: 'a'.repeat(40),
  holderDocument: '52998224725',
  address,
  idempotencyKey: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
};

describe('CheckoutCardService', () => {
  const tx = {
    checkoutOrder: { create: jest.fn(), update: jest.fn() },
    checkoutCardAttempt: { create: jest.fn(), findMany: jest.fn() },
    checkoutLead: { updateMany: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const prisma = {
    checkoutOrder: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    checkoutCardQuote: { create: jest.fn(), findFirst: jest.fn() },
    checkoutCardAttempt: {
      count: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    checkoutSettings: { findUnique: jest.fn() },
    paymentWebhookAnomaly: { upsert: jest.fn() },
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const sale = {
    companyId: 'company-a',
    productId: 'p1',
    productName: 'Porquim Anual',
    settings: { maxInstallments: 12, cardFeePayer: 'BUYER' },
    quote: { items, couponId: null, subtotalCents: 10000 },
    card,
    afterPurchase: 'ACCESS',
  };
  const catalog = { prepare: jest.fn() };
  const platform = { ready: jest.fn(), cardReady: jest.fn() };
  const orders = { orderData: jest.fn(), view: jest.fn() };
  const payments = { confirmCard: jest.fn() };
  const webhooks = { emit: jest.fn() };
  const client = {
    installmentCounts: jest.fn(),
    installmentValue: jest.fn(),
    submit: jest.fn(),
    detail: jest.fn(),
    findByAttempt: jest.fn(),
    notification: jest.fn(),
  };
  const crypto = {
    encrypt: jest.fn((value: string) => `enc:${value}`),
    decrypt: jest.fn((value: string) => value.slice(4)),
  };
  const service = new CheckoutCardService(
    prisma as unknown as PrismaService,
    catalog as unknown as CheckoutCatalogService,
    platform as unknown as CheckoutPlatformService,
    orders as unknown as CheckoutOrdersService,
    payments as unknown as CheckoutPaymentsService,
    webhooks as unknown as CheckoutWebhooksService,
    client as unknown as EfiCheckoutCardClient,
    crypto as unknown as PaymentCryptoService,
  );
  const attempt = {
    id: 'attempt-1',
    orderId: 'order-1',
    companyId: 'company-a',
    issuerIdentityId: 'identity-cifra',
    status: 'SUBMITTING',
    installments: 1,
    submissionCents: 10310,
    totalCents: 10310,
    efiChargeId: null,
    createdAt: now,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    catalog.prepare.mockResolvedValue(sale);
    platform.ready.mockResolvedValue(card.account);
    platform.cardReady.mockResolvedValue(card);
    orders.orderData.mockReturnValue({ publicToken: 'token' });
    orders.view.mockResolvedValue({ token: 'token' });
    prisma.checkoutOrder.findUnique.mockResolvedValue(null);
    prisma.checkoutOrder.findUniqueOrThrow.mockResolvedValue({
      buyerName: 'Maria Souza',
      buyerEmail: 'maria@exemplo.test',
      buyerPhone: '11999999999',
      buyerDocument: '52998224725',
    });
    prisma.checkoutCardAttempt.count.mockResolvedValue(0);
    prisma.checkoutCardQuote.findFirst.mockResolvedValue({
      id: 'quote-1',
      brand: 'visa',
      fingerprint,
      platformSettingsId: 'ps-2',
      validUntil: new Date(now.getTime() + 60_000),
      options: [option],
    });
    tx.checkoutOrder.create.mockResolvedValue({
      id: 'order-1',
      publicToken: 'token',
    });
    tx.checkoutCardAttempt.create.mockResolvedValue(attempt);
  });

  it('cotação com taxa ao comprador soma a tarifa sobre o total da Efí e respeita o máximo de parcelas', async () => {
    catalog.prepare.mockResolvedValue({
      ...sale,
      settings: { maxInstallments: 2, cardFeePayer: 'BUYER' },
    });
    client.installmentCounts.mockResolvedValue([1, 2, 3]);
    // No interest: the Efí total is the submission itself.
    client.installmentValue.mockImplementation(
      (_account: unknown, total: number, _brand: string, count: number) =>
        Math.ceil(total / count),
    );
    prisma.checkoutCardQuote.create.mockImplementation(
      ({ data }: { data: { validUntil: Date } }) => ({ id: 'q', ...data }),
    );

    const result = await service.quote(
      'porquim',
      { bumpIds: [], couponCode: null, brand: 'visa' },
      now,
    );

    expect(result.options.map((o) => o.installments)).toEqual([1, 2]);
    // 3% on the Efí total: 10000 + round(10309 × 3%) = 10309.
    expect(result.options[0]?.totalCents).toBe(10309);
    expect(result).toMatchObject({
      payeeCode: 'payee-cifra',
      environment: 'sandbox',
    });
    expect(JSON.stringify(result)).not.toContain('efiFeeCents');
    expect(catalog.prepare).toHaveBeenCalledWith(
      'porquim',
      expect.anything(),
      now,
      'CARD',
    );
  });

  it('cotação com taxa ao vendedor: o comprador paga o total da Efí e o custo fica com o vendedor', async () => {
    catalog.prepare.mockResolvedValue({
      ...sale,
      settings: { maxInstallments: 12, cardFeePayer: 'SELLER' },
    });
    client.installmentCounts.mockResolvedValue([1]);
    client.installmentValue.mockResolvedValue(10000);
    prisma.checkoutCardQuote.create.mockImplementation(
      ({ data }: { data: object }) => ({ id: 'q', ...data }),
    );

    await service.quote(
      'porquim',
      { bumpIds: [], couponCode: null, brand: 'visa' },
      now,
    );

    const saved = (
      prisma.checkoutCardQuote.create.mock.calls as [
        { data: { options: unknown } },
      ][]
    )[0]?.[0].data.options;
    expect(saved).toEqual([
      {
        installments: 1,
        installmentValueCents: 10000,
        submissionCents: 10000,
        totalCents: 10000,
        efiFeeCents: 300,
      },
    ]);
  });

  it('pedido no cartão: grava a tentativa antes de cobrar e confirma quando a Efí diz pago', async () => {
    const calls: string[] = [];
    tx.checkoutCardAttempt.create.mockImplementation(() => {
      calls.push('reserve');
      return attempt;
    });
    client.submit.mockImplementation(() => {
      calls.push('submit');
      return { chargeId: '991', status: 'paid', totalCents: 10310 };
    });
    prisma.checkoutOrder.findFirst.mockResolvedValue(null);

    await service.createOrder('porquim', orderDto, now);

    expect(calls).toEqual(['reserve', 'submit']);
    expect(tx.checkoutOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        paymentMethod: 'CARD',
        installments: 1,
        totalCents: 10310,
        surchargeCents: 310,
        efiFeeCents: 310,
        efiFeeBasisPoints: 300,
        platformSettingsId: 'ps-2',
      }) as unknown,
    });
    const sent = (
      client.submit.mock.calls as [unknown, { customer: object }][]
    )[0]?.[1];
    expect(sent).toMatchObject({
      attemptId: 'attempt-1',
      submissionCents: 10310,
      customer: { cpf: '52998224725', name: 'Maria Souza' },
    });
    expect(payments.confirmCard).toHaveBeenCalledWith('attempt-1');
    expect(webhooks.emit).toHaveBeenCalledWith(
      prisma,
      'company-a',
      'order.created',
      'order-1',
    );
  });

  it('compra sem oferta não guarda o cartão; com oferta, guarda token, CPF e endereço cifrados', async () => {
    client.submit.mockResolvedValue({
      chargeId: '991',
      status: 'approved',
      totalCents: 10310,
    });
    await service.createOrder('porquim', orderDto, now);
    expect(tx.checkoutCardAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ reuseEncrypted: null }) as unknown,
    });

    catalog.prepare.mockResolvedValue({ ...sale, afterPurchase: 'OFFER' });
    await service.createOrder('porquim', orderDto, now);
    const data = (
      tx.checkoutCardAttempt.create.mock.calls as [
        { data: { reuseEncrypted: string } },
      ][]
    )[1]?.[0].data;
    expect(data?.reuseEncrypted.startsWith('enc:')).toBe(true);
    expect(JSON.parse(data!.reuseEncrypted.slice(4))).toEqual({
      paymentToken: 'a'.repeat(40),
      holderDocument: '52998224725',
      address,
    });
  });

  it('oferta no cartão: pedido próprio ligado à compra, cobrado com o cartão guardado', async () => {
    const calls: string[] = [];
    const inTx = jest.fn(() => {
      calls.push('answer');
      return Promise.resolve();
    });
    tx.checkoutOrder.create.mockImplementation(() => {
      calls.push('order');
      return { id: 'order-2', publicToken: 'token-2' };
    });
    client.submit.mockResolvedValue({
      chargeId: '992',
      status: 'approved',
      totalCents: 10310,
    });

    await service.createOfferOrder(
      sale as never,
      {
        id: 'order-1',
        buyerName: 'Maria Souza',
        buyerEmail: 'maria@exemplo.test',
        buyerPhone: '11999999999',
        buyerDocument: '52998224725',
        utm: null,
      },
      { paymentToken: 'b'.repeat(40), holderDocument: '52998224725', address },
      {
        offerId: 'offer-1',
        quoteId: 'quote-1',
        installments: 1,
        idempotencyKey: '9c9e6679-7425-40de-944b-e07fc1f90ae7',
      },
      inTx,
      now,
    );

    expect(calls).toEqual(['answer', 'order']);
    expect(tx.checkoutOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        parentOrderId: 'order-1',
        offerId: 'offer-1',
        paymentMethod: 'CARD',
        totalCents: 10310,
      }) as unknown,
    });
    // An offer order never keeps the card again.
    expect(tx.checkoutCardAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ reuseEncrypted: null }) as unknown,
    });
    expect(client.submit).toHaveBeenCalledWith(
      card.account,
      expect.objectContaining({ paymentToken: 'b'.repeat(40) }),
    );
  });

  it('cartão guardado: lido só da tentativa paga e apagado quando a janela fecha', async () => {
    prisma.checkoutCardAttempt.findFirst.mockResolvedValue({
      brand: 'visa',
      reuseEncrypted: `enc:${JSON.stringify({ paymentToken: 'c'.repeat(40), holderDocument: '52998224725', address })}`,
    });
    await expect(service.keptCard('order-1')).resolves.toMatchObject({
      brand: 'visa',
      paymentToken: 'c'.repeat(40),
    });
    expect(prisma.checkoutCardAttempt.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          orderId: 'order-1',
          status: 'PAID',
          reuseEncrypted: { not: null },
        },
      }),
    );

    await service.wipeKeptCards(now);
    expect(prisma.checkoutCardAttempt.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        reuseEncrypted: { not: null },
      }) as unknown,
      data: { reuseEncrypted: null, reuseWipedAt: now },
    });
  });

  it('resposta perdida fica incerta e nunca é reenviada', async () => {
    client.submit.mockRejectedValue(new Error('timeout'));

    await service.createOrder('porquim', orderDto, now);

    expect(client.submit).toHaveBeenCalledTimes(1);
    expect(prisma.checkoutCardAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: 'attempt-1', status: 'SUBMITTING' },
      data: { status: 'UNCERTAIN' },
    });
    expect(payments.confirmCard).not.toHaveBeenCalled();
  });

  it('recusa do banco marca a tentativa recusada', async () => {
    client.submit.mockResolvedValue({
      chargeId: '992',
      status: 'unpaid',
      totalCents: 10310,
    });

    await service.createOrder('porquim', orderDto, now);

    expect(prisma.checkoutCardAttempt.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'attempt-1',
        status: { in: ['SUBMITTING', 'UNCERTAIN', 'APPROVED'] },
      },
      data: {
        status: 'DECLINED',
        efiChargeId: '992',
        providerStatus: 'unpaid',
      },
    });
  });

  it('cotação vencida ou de outro carrinho não cria pedido', async () => {
    prisma.checkoutCardQuote.findFirst.mockResolvedValue({
      id: 'quote-1',
      fingerprint: 'outro',
      platformSettingsId: 'ps-2',
      validUntil: new Date(now.getTime() + 60_000),
      options: [option],
    });
    await expect(
      service.createOrder('porquim', orderDto, now),
    ).rejects.toMatchObject({ response: { code: 'CARD_QUOTE_EXPIRED' } });
    expect(tx.checkoutOrder.create).not.toHaveBeenCalled();
    expect(client.submit).not.toHaveBeenCalled();
  });

  it('5 tentativas do mesmo CPF em 24 h barram o cartão', async () => {
    prisma.checkoutCardAttempt.count.mockResolvedValue(5);
    await expect(
      service.createOrder('porquim', orderDto, now),
    ).rejects.toMatchObject({ response: { code: 'CARD_ATTEMPT_LIMIT' } });
    expect(client.submit).not.toHaveBeenCalled();
  });

  it('nova tentativa: até 3 por pedido, uma de cada vez, e a mesma chave não cobra de novo', async () => {
    const order = {
      id: 'order-1',
      companyId: 'company-a',
      productId: 'p1',
      paymentMethod: 'CARD',
      status: 'PENDING',
      expiresAt: new Date(now.getTime() + 60_000),
      items,
      couponId: null,
      subtotalCents: 10000,
      buyerDocument: '52998224725',
      product: { name: 'Porquim Anual' },
    };
    const declined = {
      status: 'DECLINED',
      idempotencyKey: 'k',
      requestHash: 'h',
    };
    prisma.checkoutSettings.findUnique.mockResolvedValue({
      cardEnabled: true,
      cardPausedAt: null,
    });

    prisma.checkoutOrder.findUnique.mockResolvedValue({
      ...order,
      cardAttempts: [declined, declined, declined],
    });
    await expect(service.pay('token', orderDto, now)).rejects.toMatchObject({
      response: { code: 'CARD_ATTEMPT_LIMIT' },
    });

    prisma.checkoutOrder.findUnique.mockResolvedValue({
      ...order,
      cardAttempts: [{ ...declined, status: 'UNCERTAIN' }],
    });
    await expect(service.pay('token', orderDto, now)).rejects.toMatchObject({
      response: { code: 'CARD_PAYMENT_PROCESSING' },
    });

    prisma.checkoutOrder.findUnique.mockResolvedValue({
      ...order,
      cardAttempts: [declined],
    });
    tx.checkoutCardAttempt.findMany.mockResolvedValue([declined]);
    client.submit.mockResolvedValue({
      chargeId: '993',
      status: 'unpaid',
      totalCents: 10310,
    });
    await service.pay('token', orderDto, now);
    expect(client.submit).toHaveBeenCalledTimes(1);
    expect(tx.checkoutOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: expect.objectContaining({
        totalCents: 10310,
        installments: 1,
      }) as unknown,
    });
  });

  it('cartão pausado pelo admin recusa nova tentativa', async () => {
    prisma.checkoutOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      companyId: 'company-a',
      paymentMethod: 'CARD',
      status: 'PENDING',
      expiresAt: new Date(now.getTime() + 60_000),
      buyerDocument: '52998224725',
      cardAttempts: [],
    });
    prisma.checkoutSettings.findUnique.mockResolvedValue({
      cardEnabled: true,
      cardPausedAt: now,
    });
    await expect(service.pay('token', orderDto, now)).rejects.toMatchObject({
      response: { code: 'CARD_NOT_AVAILABLE' },
    });
  });

  it('conciliação: sem cobrança na Efí depois de 30 min, a tentativa é cancelada', async () => {
    prisma.checkoutCardAttempt.findUnique.mockResolvedValue({
      ...attempt,
      status: 'UNCERTAIN',
      createdAt: new Date(now.getTime() - 31 * 60_000),
    });
    client.findByAttempt.mockResolvedValue([]);

    await service.reconcile('attempt-1', undefined, now);

    expect(prisma.checkoutCardAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: 'attempt-1', status: { in: ['SUBMITTING', 'UNCERTAIN'] } },
      data: { status: 'CANCELED', providerStatus: 'not_found' },
    });
  });

  it('conciliação: cobrança paga achada pelo custom_id confirma o pedido', async () => {
    prisma.checkoutCardAttempt.findUnique.mockResolvedValue({
      ...attempt,
      status: 'UNCERTAIN',
    });
    client.findByAttempt.mockResolvedValue(['994']);
    client.detail.mockResolvedValue({
      chargeId: '994',
      customId: 'attempt-1',
      status: 'paid',
      method: 'credit_card',
      installments: 1,
      totalCents: 10310,
    });
    prisma.checkoutOrder.findFirst.mockResolvedValue(null);

    await service.reconcile('attempt-1', undefined, now);

    expect(payments.confirmCard).toHaveBeenCalledWith('attempt-1');
  });

  it('valor diferente ou estorno na Efí viram alerta para o admin, sem mexer no saldo', async () => {
    prisma.checkoutCardAttempt.findUnique.mockResolvedValue({
      ...attempt,
      efiChargeId: '995',
      status: 'PAID',
    });
    client.detail.mockResolvedValue({
      chargeId: '995',
      customId: 'attempt-1',
      status: 'refunded',
      method: 'credit_card',
      installments: 1,
      totalCents: 10310,
    });
    await service.reconcile('attempt-1', undefined, now);
    expect(prisma.paymentWebhookAnomaly.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          source: 'CARD',
          reasonCode: 'CHECKOUT_CARD_REFUNDED_REVIEW',
        }) as unknown,
      }),
    );

    client.detail.mockResolvedValue({
      chargeId: '995',
      customId: 'attempt-1',
      status: 'paid',
      method: 'credit_card',
      installments: 1,
      totalCents: 99,
    });
    await service.reconcile('attempt-1', undefined, now);
    expect(prisma.paymentWebhookAnomaly.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          reasonCode: 'CHECKOUT_CARD_AMOUNT_MISMATCH',
        }) as unknown,
      }),
    );
    expect(payments.confirmCard).not.toHaveBeenCalled();
  });

  it('pedido de cartão vencido com recusa fecha recusado e avisa o vendedor uma vez', async () => {
    prisma.checkoutOrder.findMany.mockResolvedValue([
      {
        id: 'order-1',
        companyId: 'company-a',
        cardAttempts: [{ status: 'DECLINED' }],
      },
      { id: 'order-2', companyId: 'company-a', cardAttempts: [] },
    ]);
    prisma.checkoutOrder.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });

    await service.closeOverdue(now);

    const updates = (
      prisma.checkoutOrder.updateMany.mock.calls as [
        { data: { status: string } },
      ][]
    ).map((call) => call[0].data.status);
    expect(updates).toEqual(['DECLINED', 'EXPIRED']);
    expect(webhooks.emit).toHaveBeenCalledTimes(1);
    expect(webhooks.emit).toHaveBeenCalledWith(
      prisma,
      'company-a',
      'order.card_declined',
      'order-1',
      {},
      now,
    );
  });

  it('aviso de outra conta não é do checkout', async () => {
    await expect(
      service.handleNotification('outra-conta', 'tok'),
    ).resolves.toBe(false);
    expect(client.notification).not.toHaveBeenCalled();
  });
});
