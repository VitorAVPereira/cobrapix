import {
  calculateCardDebt,
  cardCivilDate,
  resolveCardDiscount,
  grossUpCard,
} from './card-amounts';

describe('card financial amounts', () => {
  const input = {
    principalCents: 10000,
    discountCents: 0,
    dueDate: '2026-01-01',
    today: '2026-01-16',
    lateFineBasisPoints: 200,
    lateInterestMonthlyBasisPoints: 100,
  };
  it('uses simple monthly interest /30 and preserves principal split base', () => {
    expect(calculateCardDebt(input)).toEqual({
      principalCents: 10000,
      discountCents: 0,
      daysLate: 15,
      lateFineCents: 200,
      lateInterestCents: 50,
      baseDebtCents: 10250,
      platformFeeBaseCents: 10000,
    });
    expect(
      calculateCardDebt({ ...input, discountCents: 1000 }).platformFeeBaseCents,
    ).toBe(9000);
  });
  it.each(['2025-12-31', '2026-01-01'])(
    'does not apply charges on/before due date %s',
    (today) => {
      expect(calculateCardDebt({ ...input, today }).baseDebtCents).toBe(10000);
    },
  );
  it('uses calendar days and the same divisor in February and leap years', () => {
    expect(
      calculateCardDebt({
        ...input,
        dueDate: '2024-02-28',
        today: '2024-03-01',
      }).lateInterestCents,
    ).toBe(7);
    expect(cardCivilDate(new Date('2026-01-02T01:00:00Z'))).toBe('2026-01-01');
  });
  it('does not compound interest or add absent rates', () => {
    expect(
      calculateCardDebt({
        ...input,
        lateFineBasisPoints: 0,
        lateInterestMonthlyBasisPoints: 0,
      }).baseDebtCents,
    ).toBe(10000);
    expect(() =>
      calculateCardDebt({ ...input, discountCents: 10001 }),
    ).toThrow();
  });
  it('resolves company/debtor discount and its exact eligibility day', () => {
    const company = {
      autoDiscountEnabled: true,
      autoDiscountDaysAfterDue: 5,
      autoDiscountPercentage: 10,
    };
    expect(
      resolveCardDiscount(
        10000,
        4,
        { useGlobalBillingSettings: true },
        company,
      ),
    ).toBe(1000);
    expect(
      resolveCardDiscount(
        10000,
        5,
        { useGlobalBillingSettings: true },
        company,
      ),
    ).toBe(1000);
    expect(
      resolveCardDiscount(
        10000,
        6,
        { useGlobalBillingSettings: false, autoDiscountEnabled: false },
        company,
      ),
    ).toBe(0);
    expect(
      resolveCardDiscount(
        10000,
        3,
        {
          useGlobalBillingSettings: false,
          autoDiscountEnabled: true,
          autoDiscountDaysAfterDue: 3,
          autoDiscountPercentage: 5,
        },
        company,
      ),
    ).toBe(500);
    expect(
      resolveCardDiscount(
        10000,
        6,
        { useGlobalBillingSettings: true },
        company,
      ),
    ).toBe(0);
  });
  it('honors a full discount and blocks a zero-value card debit', () => {
    expect(
      resolveCardDiscount(
        10000,
        0,
        { useGlobalBillingSettings: true },
        { autoDiscountEnabled: true, autoDiscountPercentage: 100 },
      ),
    ).toBe(10000);
    expect(() =>
      calculateCardDebt({
        ...input,
        today: input.dueDate,
        discountCents: 10000,
      }),
    ).toThrow();
    expect(
      calculateCardDebt({ ...input, discountCents: 10000 })
        .platformFeeBaseCents,
    ).toBe(0);
  });
  it('grosses up processing fee on the total without adding provider interest twice', async () => {
    const q = await grossUpCard(10000, 2, 300, 0, (amount) =>
      Promise.resolve(Math.round((amount * 1.05) / 2)),
    );
    expect(q.totalCents).toBe(q.installmentValueCents * 2);
    expect(
      q.submissionCents - Math.round(q.totalCents * 0.03),
    ).toBeGreaterThanOrEqual(10000);
    expect(q.efiFeeCents).toBe(q.totalCents - 10000);
    expect(q.totalCents - q.submissionCents).toBeLessThan(q.totalCents * 0.051);
  });
  it('rejects malformed provider installments and unbounded tariffs', async () => {
    await expect(
      grossUpCard(10000, 7, 300, 0, () => Promise.resolve(1000)),
    ).rejects.toThrow();
    await expect(
      grossUpCard(10000, 1, 10000, 0, (x) => Promise.resolve(x)),
    ).rejects.toThrow();
    await expect(
      grossUpCard(10000, 2, 300, 0, () => Promise.resolve(NaN)),
    ).rejects.toThrow();
  });
});
