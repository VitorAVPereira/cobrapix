// Fine, interest and days accepting payment after the due date.
// Percentages travel as numbers with up to two decimals (2 = 2%) and are
// stored as basis points (200). Limits follow the database constraints:
// Efí accepts a percentage fine of up to 10%; interest is per month.
export const LATE_FINE_MAX_PERCENTAGE = 10;
export const LATE_INTEREST_MONTHLY_MAX_PERCENTAGE = 100;
export const PAYMENT_DAYS_AFTER_DUE_MAX = 365;
export const DEFAULT_PAYMENT_DAYS_AFTER_DUE = 30;

export interface LateTerms {
  lateFineBasisPoints: number;
  lateInterestMonthlyBasisPoints: number;
  paymentDaysAfterDue: number;
}

// Absent (undefined/null) means "use the company default"; an explicit zero
// means none.
export interface LateTermsInput {
  lateFinePercentage?: number | null;
  lateInterestMonthlyPercentage?: number | null;
  paymentDaysAfterDue?: number | null;
}

export interface CompanyLateDefaults {
  defaultLateFineBasisPoints: number;
  defaultLateInterestMonthlyBasisPoints: number;
  defaultPaymentDaysAfterDue: number;
}

export function percentageToBasisPoints(value: number): number {
  return Math.round(value * 100);
}

export function basisPointsToPercentage(value: number): number {
  return value / 100;
}

export function resolveLateTerms(
  input: LateTermsInput,
  defaults: CompanyLateDefaults,
): LateTerms {
  return {
    lateFineBasisPoints:
      input.lateFinePercentage == null
        ? defaults.defaultLateFineBasisPoints
        : percentageToBasisPoints(input.lateFinePercentage),
    lateInterestMonthlyBasisPoints:
      input.lateInterestMonthlyPercentage == null
        ? defaults.defaultLateInterestMonthlyBasisPoints
        : percentageToBasisPoints(input.lateInterestMonthlyPercentage),
    paymentDaysAfterDue:
      input.paymentDaysAfterDue == null
        ? defaults.defaultPaymentDaysAfterDue
        : input.paymentDaysAfterDue,
  };
}

export interface LateTermsView {
  late_fine_percentage: number;
  late_interest_monthly_percentage: number;
  payment_days_after_due: number;
}

export function toLateTermsView(terms: LateTerms): LateTermsView {
  return {
    late_fine_percentage: basisPointsToPercentage(terms.lateFineBasisPoints),
    late_interest_monthly_percentage: basisPointsToPercentage(
      terms.lateInterestMonthlyBasisPoints,
    ),
    payment_days_after_due: terms.paymentDaysAfterDue,
  };
}

// CSV cells arrive as numbers or text ("2", "2,5", "2.50", "2%"). Empty means
// the company default. Returns an error message for invalid values.
export function parseOptionalCsvPercentage(
  value: unknown,
  max: number,
): { value: number | undefined } | { error: string } {
  if (value === undefined || value === null) return { value: undefined };
  const text =
    typeof value === 'number' ? String(value) : String(value as string).trim();
  if (text === '') return { value: undefined };
  const normalized = text.replace('%', '').trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(normalized))
    return { error: 'deve ser um percentual com até 2 casas decimais' };
  const parsed = Number(normalized);
  if (parsed > max) return { error: `deve estar entre 0 e ${max}` };
  return { value: parsed };
}

export function parseOptionalCsvDays(
  value: unknown,
): { value: number | undefined } | { error: string } {
  if (value === undefined || value === null) return { value: undefined };
  const text =
    typeof value === 'number' ? String(value) : String(value as string).trim();
  if (text === '') return { value: undefined };
  if (!/^\d{1,3}$/.test(text) || Number(text) > PAYMENT_DAYS_AFTER_DUE_MAX)
    return {
      error: `deve ser um número inteiro de 0 a ${PAYMENT_DAYS_AFTER_DUE_MAX}`,
    };
  return { value: Number(text) };
}
