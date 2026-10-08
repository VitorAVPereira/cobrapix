import {
  buildCardChargeBody,
  normalizeCardSubmission,
  normalizeCardInstallments,
} from './efi-card.client';
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
            { installment: 7, value: 200 },
          ],
        },
      }),
    ).toEqual([{ installments: 1, valueCents: 1000 }]);
    expect(() =>
      normalizeCardInstallments({
        code: 200,
        data: { installments: [{ installment: 1, value: '1000' }] },
      }),
    ).toThrow();
  });
});
