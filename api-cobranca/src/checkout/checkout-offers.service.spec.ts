import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { CheckoutCatalogService } from './checkout-catalog.service';
import type { CheckoutPlatformService } from './checkout-platform.service';
import type { CheckoutOrdersService } from './checkout-orders.service';
import type { CheckoutCardService } from './checkout-card.service';
import { CheckoutOffersService } from './checkout-offers.service';
import { offerTokenHash } from './checkout-rules';

const now = new Date('2026-11-09T12:00:00Z');
const TOKEN = 'o'.repeat(43);
const product = (id: string) => ({
  id,
  name: `Produto ${id}`,
  description: null,
  imageAssetId: null,
  accessPeriodMonths: 12,
});
const upsell = {
  id: 'offer-up',
  kind: 'UPSELL' as const,
  productId: 'p-main',
  priceCents: 4900,
  compareAtPriceCents: 9700,
  headline: 'Leve também',
  description: null,
  offeredProduct: product('p-up'),
};
const downsell = {
  ...upsell,
  id: 'offer-down',
  kind: 'DOWNSELL' as const,
  priceCents: 1900,
  offeredProduct: product('p-down'),
};
const mainItem = {
  kind: 'MAIN',
  productId: 'p-main',
  deliveryMode: 'ACCESS_LINK',
  accessUrl: 'https://acesso.test/main',
  accessPeriodMonths: null,
};

describe('CheckoutOffersService', () => {
  const tx = {
    $queryRaw: jest.fn(),
    checkoutOrder: { findFirst: jest.fn() },
    checkoutOfferResponse: { findUnique: jest.fn(), create: jest.fn() },
  };
  const prisma = {
    checkoutOrder: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    checkoutOffer: { findMany: jest.fn(), findFirst: jest.fn() },
    checkoutSettings: { findUnique: jest.fn() },
    checkoutOfferResponse: { upsert: jest.fn() },
  };
  const catalog = { prepareOffer: jest.fn() };
  const platform = { ready: jest.fn(), cardReady: jest.fn() };
  const orders = { createPix: jest.fn(), view: jest.fn() };
  const card = {
    keptCard: jest.fn(),
    quoteFor: jest.fn(),
    createOfferOrder: jest.fn(),
  };
  const service = new CheckoutOffersService(
    prisma as unknown as PrismaService,
    catalog as unknown as CheckoutCatalogService,
    platform as unknown as CheckoutPlatformService,
    orders as unknown as CheckoutOrdersService,
    card as unknown as CheckoutCardService,
  );
  const origin = (overrides: object = {}) => ({
    id: 'order-1',
    companyId: 'company-a',
    productId: 'p-main',
    status: 'PAID',
    items: [mainItem],
    utm: null,
    buyerName: 'Maria Souza',
    buyerEmail: 'maria@exemplo.test',
    buyerPhone: '11999999999',
    buyerDocument: '52998224725',
    offerExpiresAt: new Date(now.getTime() + 30 * 60_000),
    product: { afterPurchase: 'OFFER' },
    offerResponses: [],
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.checkoutOrder.findUnique.mockImplementation(
      ({ where }: { where: { offerTokenHash?: string } }) =>
        where.offerTokenHash === offerTokenHash(TOKEN) ? origin() : null,
    );
    prisma.checkoutOrder.findMany.mockResolvedValue([
      { items: [mainItem], paidAt: now },
    ]);
    prisma.checkoutOrder.findFirst.mockResolvedValue(null);
    prisma.checkoutOffer.findMany.mockResolvedValue([upsell, downsell]);
    prisma.checkoutOffer.findFirst.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        [upsell, downsell].find((offer) => offer.id === where.id) ?? null,
    );
    prisma.checkoutSettings.findUnique.mockResolvedValue({
      displayName: 'Porquim',
      primaryColor: '#0F766E',
      logoAssetId: null,
      supportEmail: null,
      supportWhatsapp: null,
      pixEnabled: true,
      cardEnabled: true,
      cardPausedAt: null,
      maxInstallments: 12,
    });
    platform.ready.mockResolvedValue({});
    platform.cardReady.mockResolvedValue({});
    card.keptCard.mockResolvedValue(null);
    tx.checkoutOrder.findFirst.mockResolvedValue(null);
    tx.checkoutOfferResponse.findUnique.mockResolvedValue(null);
    catalog.prepareOffer.mockResolvedValue({ companyId: 'company-a' });
    orders.createPix.mockImplementation(
      async (
        _sale: unknown,
        _dto: unknown,
        _document: unknown,
        _now: unknown,
        hooks: { before: (client: typeof tx) => Promise<void> },
      ) => {
        await hooks.before(tx);
        return { token: 'offer-order' };
      },
    );
  });

  it('mostra o upsell; recusado, o downsell; recusado de novo, segue para o acesso', async () => {
    const first = await service.view(TOKEN, undefined, now);
    expect(first).toMatchObject({
      state: 'OFFER',
      offer: { id: 'offer-up', kind: 'UPSELL', priceCents: 4900 },
      accessUrl: 'https://acesso.test/main',
      payment: { pixEnabled: true, card: null },
    });

    prisma.checkoutOrder.findUnique.mockResolvedValue(
      origin({
        offerResponses: [{ offerId: 'offer-up', decision: 'DECLINED' }],
      }),
    );
    await expect(service.view(TOKEN, undefined, now)).resolves.toMatchObject({
      state: 'OFFER',
      offer: { id: 'offer-down', kind: 'DOWNSELL' },
    });

    prisma.checkoutOrder.findUnique.mockResolvedValue(
      origin({
        offerResponses: [
          { offerId: 'offer-up', decision: 'DECLINED' },
          { offerId: 'offer-down', decision: 'DECLINED' },
        ],
      }),
    );
    await expect(service.view(TOKEN, undefined, now)).resolves.toMatchObject({
      state: 'DONE',
      offer: null,
      accessUrl: 'https://acesso.test/main',
    });
  });

  it('quem já tem o produto oferecido não vê a oferta', async () => {
    prisma.checkoutOrder.findMany.mockResolvedValue([
      { items: [{ ...mainItem, productId: 'p-up' }], paidAt: now },
    ]);
    await expect(service.view(TOKEN, undefined, now)).resolves.toMatchObject({
      state: 'DONE',
    });
  });

  it('link vencido fecha a oferta; token desconhecido é "não encontrado"', async () => {
    prisma.checkoutOrder.findUnique.mockResolvedValue(
      origin({ offerExpiresAt: new Date(now.getTime() - 1) }),
    );
    await expect(service.view(TOKEN, undefined, now)).resolves.toMatchObject({
      state: 'CLOSED',
      offer: null,
    });
    await expect(
      service.accept(
        TOKEN,
        {
          offerId: 'offer-up',
          method: 'PIX',
          idempotencyKey: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        },
        now,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    prisma.checkoutOrder.findUnique.mockResolvedValue(null);
    await expect(
      service.view('x'.repeat(43), undefined, now),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('página do vendedor: mostra a oferta pedida, só da mesma empresa', async () => {
    prisma.checkoutOrder.findUnique.mockResolvedValue(
      origin({ product: { afterPurchase: 'EXTERNAL' } }),
    );
    prisma.checkoutOffer.findFirst.mockResolvedValue(downsell);
    await expect(service.view(TOKEN, 'offer-down', now)).resolves.toMatchObject(
      { state: 'OFFER', offer: { id: 'offer-down' } },
    );
    expect(prisma.checkoutOffer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'offer-down',
          companyId: 'company-a',
          active: true,
        }) as unknown,
      }),
    );
    // Without an offer id, a seller page purchase has nothing on this page.
    await expect(service.view(TOKEN, undefined, now)).resolves.toMatchObject({
      state: 'DONE',
    });
  });

  it('aceite no Pix: pedido próprio ligado à compra e resposta gravada na mesma transação', async () => {
    await service.accept(
      TOKEN,
      {
        offerId: 'offer-up',
        method: 'PIX',
        idempotencyKey: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      },
      now,
    );

    expect(catalog.prepareOffer).toHaveBeenCalledWith(
      'company-a',
      'offer-up',
      'PIX',
    );
    const call = orders.createPix.mock.calls[0] as unknown[];
    expect(call[1]).toMatchObject({
      buyer: { name: 'Maria Souza', email: 'maria@exemplo.test' },
    });
    expect(call[2]).toBe('52998224725');
    expect(call[4]).toMatchObject({
      extra: { parentOrderId: 'order-1', offerId: 'offer-up' },
    });
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.checkoutOfferResponse.create).toHaveBeenCalledWith({
      data: {
        orderId: 'order-1',
        companyId: 'company-a',
        offerId: 'offer-up',
        decision: 'ACCEPTED',
      },
    });
  });

  it('a mesma oferta não é aceita duas vezes enquanto o primeiro pedido está aberto', async () => {
    tx.checkoutOrder.findFirst.mockResolvedValue({
      publicToken: 'offer-order',
      status: 'PENDING',
      paymentMethod: 'PIX',
      expiresAt: new Date(now.getTime() + 60_000),
      cardAttempts: [],
      attempt: { status: 'ACTIVE' },
    });
    await expect(
      service.accept(
        TOKEN,
        {
          offerId: 'offer-up',
          method: 'PIX',
          idempotencyKey: '8c9e6679-7425-40de-944b-e07fc1f90ae7',
        },
        now,
      ),
    ).rejects.toMatchObject({
      response: { code: 'CHECKOUT_OFFER_IN_PROGRESS' },
    });
  });

  it('cartão recusado na oferta: a página oferece só Pix e o aceite no cartão é barrado', async () => {
    card.keptCard.mockResolvedValue({
      brand: 'visa',
      paymentToken: 't'.repeat(40),
      holderDocument: '52998224725',
      address: {},
    });
    const declined = {
      publicToken: 'offer-order',
      status: 'PENDING',
      paymentMethod: 'CARD',
      expiresAt: new Date(now.getTime() + 60_000),
      cardAttempts: [{ status: 'DECLINED' }],
      attempt: null,
    };
    prisma.checkoutOrder.findFirst.mockResolvedValue(declined);

    await expect(service.view(TOKEN, undefined, now)).resolves.toMatchObject({
      state: 'OFFER',
      order: null,
      payment: { pixEnabled: true, card: null },
    });
    await expect(
      service.accept(
        TOKEN,
        {
          offerId: 'offer-up',
          method: 'CARD',
          quoteId: '9c9e6679-7425-40de-944b-e07fc1f90ae7',
          installments: 1,
          idempotencyKey: 'ac9e6679-7425-40de-944b-e07fc1f90ae7',
        },
        now,
      ),
    ).rejects.toMatchObject({ response: { code: 'CARD_NOT_AVAILABLE' } });
    expect(card.createOfferOrder).not.toHaveBeenCalled();
  });

  it('recusa grava a decisão e devolve a próxima oferta', async () => {
    await service.decline(TOKEN, { offerId: 'offer-up' }, now);
    expect(prisma.checkoutOfferResponse.upsert).toHaveBeenCalledWith({
      where: { orderId_offerId: { orderId: 'order-1', offerId: 'offer-up' } },
      create: {
        orderId: 'order-1',
        companyId: 'company-a',
        offerId: 'offer-up',
        decision: 'DECLINED',
      },
      update: { decision: 'DECLINED' },
    });
  });
});
