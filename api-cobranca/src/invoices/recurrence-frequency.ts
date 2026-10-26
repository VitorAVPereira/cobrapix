import type { RecurrenceFrequency } from '@prisma/client';

export const RECURRENCE_FREQUENCIES = [
  'WEEKLY',
  'BIWEEKLY',
  'MONTHLY',
  'BIMONTHLY',
  'QUARTERLY',
  'SEMIANNUAL',
  'YEARLY',
] as const satisfies readonly RecurrenceFrequency[];

const DAY_IN_MS = 24 * 60 * 60 * 1000;

// Quinzenal is every 14 days: the same weekday, every other week.
const STEP: Record<
  RecurrenceFrequency,
  { weeks: number } | { months: number }
> = {
  WEEKLY: { weeks: 1 },
  BIWEEKLY: { weeks: 2 },
  MONTHLY: { months: 1 },
  BIMONTHLY: { months: 2 },
  QUARTERLY: { months: 3 },
  SEMIANNUAL: { months: 6 },
  YEARLY: { months: 12 },
};

export function isMonthBased(frequency: RecurrenceFrequency): boolean {
  return 'months' in STEP[frequency];
}

/** Due date on `dueDay` of a month; day 31 falls on the last day of shorter months. */
export function monthlyDueDate(
  year: number,
  monthIndex: number,
  dueDay: number,
): Date {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(year, monthIndex, Math.min(dueDay, lastDay), 12, 0, 0),
  );
}

/**
 * Occurrence after `current`. Month-based ones keep `dueDay`, so a recurrence on day 31
 * is back on day 31 after a short month.
 */
export function nextRecurringDueDate(
  current: Date,
  dueDay: number,
  frequency: RecurrenceFrequency,
): Date {
  const step = STEP[frequency];
  if ('weeks' in step)
    return new Date(current.getTime() + step.weeks * 7 * DAY_IN_MS);
  return monthlyDueDate(
    current.getUTCFullYear(),
    current.getUTCMonth() + step.months,
    dueDay,
  );
}

/** First occurrence on or after `today` (YYYY-MM-DD), starting at `dueDate`. */
export function firstOccurrenceFrom(
  dueDate: Date,
  dueDay: number,
  frequency: RecurrenceFrequency,
  today: string,
): Date {
  let next = dueDate;
  while (next.toISOString().slice(0, 10) < today) {
    next = nextRecurringDueDate(next, dueDay, frequency);
  }
  return next;
}

/**
 * Key of an occurrence, unique per recurrence. Month-based frequencies have at most one
 * invoice per month and keep the "YYYY-MM" of the invoices generated before; weekly ones
 * use the due date.
 */
export function recurrencePeriodKey(
  dueDate: Date,
  frequency: RecurrenceFrequency,
): string {
  const iso = dueDate.toISOString();
  return isMonthBased(frequency) ? iso.slice(0, 7) : iso.slice(0, 10);
}

/** How early an invoice is generated: up to 30 days, never more than one interval. */
export function generationLookaheadDays(
  frequency: RecurrenceFrequency,
): number {
  const step = STEP[frequency];
  return 'weeks' in step ? step.weeks * 7 : 30;
}

/** Amount per month, to add recurrences of different frequencies together. */
export function monthlyEquivalent(
  amount: number,
  frequency: RecurrenceFrequency,
): number {
  const step = STEP[frequency];
  return 'weeks' in step
    ? (amount * 52) / (12 * step.weeks)
    : amount / step.months;
}
