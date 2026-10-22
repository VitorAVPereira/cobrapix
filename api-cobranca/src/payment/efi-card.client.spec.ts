import {
  buildCardChargeBody,
  cardProcessingBasisPoints,
  cardProcessingRate,
  CardProcessingRates,
  EfiCardClient,
  normalizeCardSubmission,
  normalizeCardInstallments,
} from './efi-card.client';
describe('Efí card tariff', () => {
  const anticipated: CardProcessingRates = {
    receipt: 'ANTICIPATED',
    cashBasisPoints: 349,
    anticipationBasisPoints: 129,
  };
  const installments: CardProcessingRates = {
    receipt: 'INSTALLMENTS',
    cashBasisPoints: 349,
    upTo6BasisPoints: 399,
    upTo12BasisPoints: 439,
  };
  it('charges anticipation for each installment after the first', () => {
    expect(cardProcessingBasisPoints(anticipated, 1)).toBe(349);
    expect(cardProcessingBasisPoints(anticipated, 2)).toBe(478);
    expect(cardProcessingBasisPoints(anticipated, 12)).toBe(1768);
  });
  it('uses the 2x-6x and 7x-12x rates when receiving installments', () => {
    expect(cardProcessingBasisPoints(installments, 1)).toBe(349);
    expect(cardProcessingBasisPoints(installments, 2)).toBe(399);
    expect(cardProcessingBasisPoints(installments, 6)).toBe(399);
    expect(cardProcessingBasisPoints(installments, 7)).toBe(439);
    expect(cardProcessingBasisPoints(installments, 12)).toBe(439);
  });
  it('keeps quoting legacy per-brand settings only up to their own rows', () => {
    const legacy = [
      { brand: 'visa', installments: 1, basisPoints: 300, fixedCents: 10 },
      { brand: 'visa', installments: 6, basisPoints: 400, fixedCents: 0 },
    ];
    expect(cardProcessingRate(legacy, 'visa', 1)).toEqual({
      basisPoints: 300,
      fixedCents: 10,
    });
    expect(cardProcessingRate(legacy, 'visa', 7)).toBeNull();
    expect(cardProcessingRate(legacy, 'elo', 1)).toBeNull();
    expect(cardProcessingRate(installments, 'elo', 12)).toEqual({
      basisPoints: 439,
      fixedCents: 0,
    });
  });
  it('offers up to 12x and keeps the debt net of each tariff', async () => {
    const client = new EfiCardClient({} as never, {} as never, {} as never);
    // Simulated Efí installment interest of 2% per extra installment.
    const getInstallments = ({ total }: { total: number }) =>
      Promise.resolve({
        code: 200,
        data: {
          installments: Array.from({ length: 12 }, (_, i) => ({
            installment: i + 1,
            value: Math.ceil((total * (1 + 0.02 * i)) / (i + 1)),
          })),
        },
      });
    jest
      .spyOn(client, 'account')
      .mockResolvedValue({ sdk: { getInstallments } } as never);
    const options = await client.quote(
      'issuer',
      'company',
      10000,
      'visa',
      installments,
    );
    expect(options.map((o) => o.installments)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    for (const o of options) {
      const bp = cardProcessingBasisPoints(installments, o.installments);
      expect(o.submissionCents - Math.round((o.totalCents * bp) / 10000)).toBe(
        10000,
      );
    }
  });
});
describe('Efí card protocol', () => {
  it('uses one grossed up item and a fixed split with mode 1', () => {
    const body = buildCardChargeBody(
      {
        id: 'attempt',
        invoiceId: 'invoice',
        submissionCents: 10400,
        installments: 2,
        platformFeeCents: 180,
      },
      'token',
      {
        name: 'Pessoa',
        cpf: '94271564656',
        email: 'p@example.com',
        phone_number: '11999999999',
      },
      {
        street: 'Rua',
        number: '1',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        zipcode: '01001000',
      },
      'platform',
      'https://api.example.com/webhooks/efi/cobrancas?account=issuer',
    );
    expect(body.items[0].value).toBe(10400);
    expect(body.items[0].marketplace).toEqual({
      mode: 1,
      repasses: [{ payee_code: 'platform', fixed: 180 }],
    });
    expect(body.metadata.custom_id).toBe('attempt');
    expect(body.payment.credit_card.installments).toBe(2);
    expect(body.payment.credit_card.payment_token).toBe('token');
  });
  it('never treats a 200 refusal as paid', () => {
    expect(
      normalizeCardSubmission({
        code: 200,
        data: { charge_id: 12, status: 'unpaid', total: 10000 },
      }).status,
    ).toBe('unpaid');
    expect(
      normalizeCardSubmission({
        code: 200,
        data: { charge_id: 12, status: 'approved', total: 10000 },
      }).status,
    ).toBe('approved');
    expect(() => normalizeCardSubmission({ code: 200, data: {} })).toThrow();
  });
  it('reads the installment total separately from the item total', () => {
    expect(
      normalizeCardSubmission({
        code: 200,
        data: {
          charge_id: 13,
          status: 'approved',
          total: 10000,
          credit_card: { installments: 2, installment_value: 5300 },
        },
      }).totalCents,
    ).toBe(10600);
  });
  it('filters unsupported installments and refuses malformed monetary values', () => {
    expect(
      normalizeCardInstallments({
        code: 200,
        data: {
          installments: [
            { installment: 1, value: 1000 },
            { installment: 12, value: 100 },
            { installment: 13, value: 90 },
          ],
        },
      }),
    ).toEqual([
      { installments: 1, valueCents: 1000 },
      { installments: 12, valueCents: 100 },
    ]);
    expect(() =>
      normalizeCardInstallments({
        code: 200,
        data: { installments: [{ installment: 1, value: '1000' }] },
      }),
    ).toThrow();
  });
});
