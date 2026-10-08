import { assertNewBillingMethod } from './billing-method-policy';

describe('new billing method policy', () => {
  it.each(['PIX', 'BOLIX', 'CREDIT_CARD'])('accepts %s', (method) => {
    expect(() => assertNewBillingMethod(method)).not.toThrow();
  });
  it.each(['BOLETO', 'unknown'])('rejects %s before issuance', (method) => {
    expect(() => assertNewBillingMethod(method)).toThrow(
      'Novas cobranças devem usar Pix, Bolix ou cartão de crédito.',
    );
  });
});
