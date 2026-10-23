import {
  firstOccurrenceFrom,
  generationLookaheadDays,
  monthlyEquivalent,
  nextRecurringDueDate,
  recurrencePeriodKey,
} from './recurrence-frequency';

const at = (date: string) => new Date(`${date}T12:00:00.000Z`);
const day = (date: Date) => date.toISOString().slice(0, 10);

describe('recurrence frequency', () => {
  it('weekly and biweekly keep the weekday', () => {
    expect(day(nextRecurringDueDate(at('2026-10-26'), 26, 'WEEKLY'))).toBe(
      '2026-11-02',
    );
    expect(day(nextRecurringDueDate(at('2026-10-26'), 26, 'BIWEEKLY'))).toBe(
      '2026-11-09',
    );
  });

  it('month-based frequencies clamp day 31 and come back to it', () => {
    const feb = nextRecurringDueDate(at('2027-01-31'), 31, 'MONTHLY');
    expect(day(feb)).toBe('2027-02-28');
    expect(day(nextRecurringDueDate(feb, 31, 'MONTHLY'))).toBe('2027-03-31');
    expect(day(nextRecurringDueDate(at('2026-11-30'), 31, 'QUARTERLY'))).toBe(
      '2027-02-28',
    );
    expect(day(nextRecurringDueDate(at('2026-10-10'), 10, 'BIMONTHLY'))).toBe(
      '2026-12-10',
    );
    expect(day(nextRecurringDueDate(at('2026-10-10'), 10, 'SEMIANNUAL'))).toBe(
      '2027-04-10',
    );
    expect(day(nextRecurringDueDate(at('2028-02-29'), 29, 'YEARLY'))).toBe(
      '2029-02-28',
    );
  });

  it('skips occurrences before today', () => {
    expect(
      day(firstOccurrenceFrom(at('2026-01-10'), 10, 'MONTHLY', '2026-05-11')),
    ).toBe('2026-06-10');
    expect(
      day(firstOccurrenceFrom(at('2026-10-05'), 5, 'WEEKLY', '2026-10-19')),
    ).toBe('2026-10-19');
    expect(
      day(firstOccurrenceFrom(at('2026-12-10'), 10, 'QUARTERLY', '2026-10-23')),
    ).toBe('2026-12-10');
  });

  it('keys month-based occurrences by month and weekly ones by day', () => {
    expect(recurrencePeriodKey(at('2026-11-10'), 'MONTHLY')).toBe('2026-11');
    expect(recurrencePeriodKey(at('2026-11-10'), 'YEARLY')).toBe('2026-11');
    expect(recurrencePeriodKey(at('2026-11-10'), 'WEEKLY')).toBe('2026-11-10');
    expect(recurrencePeriodKey(at('2026-11-10'), 'BIWEEKLY')).toBe(
      '2026-11-10',
    );
  });

  it('generates at most one interval ahead', () => {
    expect(generationLookaheadDays('WEEKLY')).toBe(7);
    expect(generationLookaheadDays('BIWEEKLY')).toBe(14);
    expect(generationLookaheadDays('MONTHLY')).toBe(30);
    expect(generationLookaheadDays('YEARLY')).toBe(30);
  });

  it('converts amounts to a month', () => {
    expect(monthlyEquivalent(120, 'MONTHLY')).toBe(120);
    expect(monthlyEquivalent(120, 'WEEKLY')).toBe(520);
    expect(monthlyEquivalent(120, 'BIWEEKLY')).toBe(260);
    expect(monthlyEquivalent(120, 'QUARTERLY')).toBe(40);
    expect(monthlyEquivalent(120, 'YEARLY')).toBe(10);
  });
});
