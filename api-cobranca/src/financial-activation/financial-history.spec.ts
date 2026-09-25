import { redactChanges } from './financial-history.service';

describe('financial history redaction', () => {
  it('keeps only known, non-sensitive keys', () => {
    expect(
      redactChanges({
        accountMode: 'CUSTOMER_ACCOUNT',
        efiAccountNumber: '••••1234',
        clientSecret: 'secret',
        holderDocument: '11222333000181',
        settlementIds: ['a', 'b'],
        refundPlatformFeeOnRefund: { from: false, to: true, extra: 'x' },
        reason: 'x'.repeat(300),
      }),
    ).toEqual({
      accountMode: 'CUSTOMER_ACCOUNT',
      efiAccountNumber: '••••1234',
      refundPlatformFeeOnRefund: { from: false, to: true },
      reason: 'x'.repeat(200),
    });
    expect(redactChanges(null)).toBeNull();
    expect(redactChanges(undefined)).toBeUndefined();
  });
});
