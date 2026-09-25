import {
  maxExpectedPaymentCents,
  proportionalReversal,
} from './settlement-ledger';

describe('settlement arithmetic', () => {
  it('reverses the CifraMais fee proportionally, in whole cents, never above the fee', () => {
    expect(proportionalReversal(255, 5100, 10200)).toBe(128);
    expect(proportionalReversal(255, 10200, 10200)).toBe(255);
    expect(proportionalReversal(255, 20000, 10200)).toBe(255);
    expect(proportionalReversal(0, 5000, 10000)).toBe(0);
    expect(proportionalReversal(250, 0, 10000)).toBe(0);
    // Large values stay exact.
    expect(proportionalReversal(99_999_999, 99_999_998, 99_999_999)).toBe(
      99_999_998,
    );
  });

  it('bounds a late payment by the fine and daily interest of the charge', () => {
    const dueDate = new Date('2026-01-10T00:00:00.000Z');
    const base = {
      grossAmountCents: 10000,
      dueDate,
      lateFineBasisPoints: 200,
      lateInterestMonthlyBasisPoints: 100,
    };
    // Paid on the due date: nothing beyond the charge.
    expect(
      maxExpectedPaymentCents({
        ...base,
        paidAt: new Date('2026-01-10T23:00:00.000Z'),
      }),
    ).toBe(10000);
    // Ten days late: 2% fine + 10/30 of 1%.
    expect(
      maxExpectedPaymentCents({
        ...base,
        paidAt: new Date('2026-01-20T12:00:00.000Z'),
      }),
    ).toBe(10000 + 200 + 34);
    expect(
      maxExpectedPaymentCents({
        ...base,
        lateFineBasisPoints: 0,
        lateInterestMonthlyBasisPoints: 0,
        paidAt: new Date('2026-02-20T12:00:00.000Z'),
      }),
    ).toBe(10000);
  });
});
