import {
  couponIssue,
  itemShares,
  quoteOrder,
  type PricedCoupon,
  type PricedProduct,
} from './checkout-pricing';

const product = (id: string, priceCents: number): PricedProduct => ({
  id,
  name: `Produto ${id}`,
  priceCents,
  deliveryMode: 'ACCESS_LINK',
  accessUrl: `https://acesso.test/${id}`,
  accessInstructions: null,
  accessPeriodMonths: 12,
});

const coupon = (change: Partial<PricedCoupon> = {}): PricedCoupon => ({
  id: 'coupon-1',
  code: 'PORQUIM10',
  type: 'PERCENT',
  value: 1000,
  active: true,
  startsAt: null,
  expiresAt: null,
  maxUses: null,
  usedCount: 0,
  appliesToAllProducts: true,
  productIds: [],
  ...change,
});

const now = new Date('2026-11-04T15:00:00Z');

describe('quoteOrder', () => {
  const base = {
    product: product('main', 6700),
    bumps: [
      { id: 'bump-1', priceCents: 1490, offeredProduct: product('guia', 2990) },
    ],
    platformFeeBasisPoints: 250,
    efiFeeBasisPoints: 119,
  };

  it('vendedor paga a tarifa: o total é o preço dos itens', () => {
    const quote = quoteOrder({ ...base, coupon: null, feePayer: 'SELLER' });

    expect(quote.subtotalCents).toBe(8190);
    expect(quote.totalCents).toBe(8190);
    expect(quote.surchargeCents).toBe(0);
    expect(quote.efiFeeCents).toBe(97); // 1,19% de 81,90
    expect(quote.platformFeeCents).toBe(205); // 2,5% de 81,90
    expect(quote.items.map((line) => [line.kind, line.unitPriceCents])).toEqual(
      [
        ['MAIN', 6700],
        ['BUMP', 1490],
      ],
    );
  });

  it('comprador paga a tarifa: o vendedor fica com o subtotal e a % Cifra+ ignora o acréscimo', () => {
    const quote = quoteOrder({ ...base, coupon: null, feePayer: 'BUYER' });

    expect(quote.totalCents).toBe(8289); // ceil(8190 / 0,9881)
    expect(quote.surchargeCents).toBe(99);
    expect(quote.totalCents - quote.efiFeeCents).toBeGreaterThanOrEqual(8190);
    expect(quote.platformFeeCents).toBe(205);
  });

  it('o cupom desconta só o produto principal', () => {
    const quote = quoteOrder({ ...base, coupon: coupon(), feePayer: 'SELLER' });

    expect(quote.discountCents).toBe(670);
    expect(quote.subtotalCents).toBe(8190 - 670);
    expect(quote.items.map((line) => line.discountCents)).toEqual([670, 0]);
    expect(quote.couponCode).toBe('PORQUIM10');
  });

  it('copia a entrega de cada item para o pedido', () => {
    const quote = quoteOrder({ ...base, coupon: null, feePayer: 'SELLER' });
    expect(quote.items[1]).toMatchObject({
      productId: 'guia',
      bumpId: 'bump-1',
      accessUrl: 'https://acesso.test/guia',
    });
  });
});

describe('couponIssue', () => {
  it.each([
    ['inexistente', null, 'Cupom não encontrado.'],
    ['inativo', coupon({ active: false }), 'Cupom não encontrado.'],
    [
      'antes do início',
      coupon({ startsAt: new Date('2026-11-05T03:00:00Z') }),
      'Este cupom ainda não está valendo.',
    ],
    [
      'vencido',
      coupon({ expiresAt: new Date('2026-11-04T02:59:59Z') }),
      'Este cupom expirou.',
    ],
    ['esgotado', coupon({ maxUses: 3, usedCount: 3 }), 'Este cupom esgotou.'],
    [
      'de outro produto',
      coupon({ appliesToAllProducts: false, productIds: ['outro'] }),
      'Este cupom não vale para este produto.',
    ],
  ])('cupom %s', (_label, value, message) => {
    expect(couponIssue(value, 'main', now)).toBe(message);
  });

  it('cupom válido para o produto', () => {
    expect(
      couponIssue(
        coupon({ appliesToAllProducts: false, productIds: ['main'] }),
        'main',
        now,
      ),
    ).toBeNull();
  });
});

describe('itemShares', () => {
  const line = (unitPriceCents: number, discountCents = 0) => ({
    unitPriceCents,
    discountCents,
  });

  it('divide o total pago (com acréscimo) na proporção de cada item, somando exatamente o total', () => {
    // 67,00 − 6,70 de cupom + bump 14,90 = 75,20; comprador pagou 76,11 com a tarifa.
    const shares = itemShares([line(6700, 670), line(1490)], 7611);
    expect(shares).toEqual([6103, 1508]);
    expect(shares[0]! + shares[1]!).toBe(7611);
  });

  it('o resto dos centavos vai para quem tem a maior fração', () => {
    expect(itemShares([line(100), line(100), line(100)], 1000)).toEqual([
      334, 333, 333,
    ]);
  });

  it('sem acréscimo, cada item devolve o que custou', () => {
    expect(itemShares([line(6700, 670), line(1490)], 7520)).toEqual([
      6030, 1490,
    ]);
  });
});
