import {
  parseOptionalCsvDays,
  parseOptionalCsvPercentage,
  resolveLateTerms,
  toLateTermsView,
} from './late-terms';

describe('late terms', () => {
  const defaults = {
    defaultLateFineBasisPoints: 200,
    defaultLateInterestMonthlyBasisPoints: 100,
    defaultPaymentDaysAfterDue: 30,
  };

  it('uses the company default for absent values and keeps explicit zero', () => {
    expect(resolveLateTerms({}, defaults)).toEqual({
      lateFineBasisPoints: 200,
      lateInterestMonthlyBasisPoints: 100,
      paymentDaysAfterDue: 30,
    });
    expect(
      resolveLateTerms(
        {
          lateFinePercentage: 0,
          lateInterestMonthlyPercentage: null,
          paymentDaysAfterDue: 0,
        },
        defaults,
      ),
    ).toEqual({
      lateFineBasisPoints: 0,
      lateInterestMonthlyBasisPoints: 100,
      paymentDaysAfterDue: 0,
    });
  });

  it('converts percentages with two decimals exactly', () => {
    expect(
      resolveLateTerms(
        { lateFinePercentage: 1.15, lateInterestMonthlyPercentage: 0.33 },
        defaults,
      ),
    ).toMatchObject({
      lateFineBasisPoints: 115,
      lateInterestMonthlyBasisPoints: 33,
    });
    expect(
      toLateTermsView({
        lateFineBasisPoints: 115,
        lateInterestMonthlyBasisPoints: 33,
        paymentDaysAfterDue: 5,
      }),
    ).toEqual({
      late_fine_percentage: 1.15,
      late_interest_monthly_percentage: 0.33,
      payment_days_after_due: 5,
    });
  });

  it('parses CSV cells', () => {
    expect(parseOptionalCsvPercentage(' 2,50 ', 10)).toEqual({ value: 2.5 });
    expect(parseOptionalCsvPercentage('2%', 10)).toEqual({ value: 2 });
    expect(parseOptionalCsvPercentage(0, 10)).toEqual({ value: 0 });
    expect(parseOptionalCsvPercentage('', 10)).toEqual({ value: undefined });
    expect(parseOptionalCsvPercentage('-1', 10)).toHaveProperty('error');
    expect(parseOptionalCsvPercentage('1.234', 10)).toHaveProperty('error');
    expect(parseOptionalCsvPercentage('10.01', 10)).toHaveProperty('error');
    expect(parseOptionalCsvDays('30')).toEqual({ value: 30 });
    expect(parseOptionalCsvDays(undefined)).toEqual({ value: undefined });
    expect(parseOptionalCsvDays('366')).toHaveProperty('error');
  });
});
