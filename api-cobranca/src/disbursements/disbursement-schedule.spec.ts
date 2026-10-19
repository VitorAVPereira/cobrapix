import {
  endOfSaoPauloDay,
  occurrenceDate,
  parsePaymentDate,
  requestTimeReached,
  withinSchedule,
} from './disbursement-schedule';

describe('disbursement schedule dates', () => {
  it('repeats every N days or weeks from the first date', () => {
    expect(occurrenceDate('2026-10-30', 'DAY', 3, 1)).toBe('2026-10-30');
    expect(occurrenceDate('2026-10-30', 'DAY', 3, 2)).toBe('2026-11-02');
    expect(occurrenceDate('2026-10-19', 'WEEK', 2, 3)).toBe('2026-11-16');
  });

  it('keeps day 31 across shorter months instead of drifting to 28', () => {
    const dates = [1, 2, 3, 4, 5].map((n) =>
      occurrenceDate('2026-10-31', 'MONTH', 1, n),
    );
    expect(dates).toEqual([
      '2026-10-31',
      '2026-11-30',
      '2026-12-31',
      '2027-01-31',
      '2027-02-28',
    ]);
    expect(occurrenceDate('2026-10-31', 'MONTH', 1, 6)).toBe('2027-03-31');
    expect(occurrenceDate('2027-11-29', 'MONTH', 3, 2)).toBe('2028-02-29');
  });

  it('ends after the chosen date or number of times', () => {
    const byDate = { endsOn: '2026-12-31', maxOccurrences: null };
    expect(withinSchedule(byDate, 3, '2026-12-31')).toBe(true);
    expect(withinSchedule(byDate, 4, '2027-01-31')).toBe(false);
    const byCount = { endsOn: null, maxOccurrences: 3 };
    expect(withinSchedule(byCount, 3, '2030-01-01')).toBe(true);
    expect(withinSchedule(byCount, 4, '2030-01-01')).toBe(false);
    expect(
      withinSchedule({ endsOn: null, maxOccurrences: null }, 999, '2099-01-01'),
    ).toBe(true);
  });

  it('asks at 08:00 in São Paulo (11:00 UTC) and accepts until 23:59 there', () => {
    expect(
      requestTimeReached('2026-11-05', new Date('2026-11-05T10:59:59Z')),
    ).toBe(false);
    expect(
      requestTimeReached('2026-11-05', new Date('2026-11-05T11:00:00Z')),
    ).toBe(true);
    expect(endOfSaoPauloDay('2026-11-05').toISOString()).toBe(
      '2026-11-06T02:59:59.999Z',
    );
  });

  it('accepts today or a later date, never a past one', () => {
    // 21:30 of 18/10 in São Paulo is already 19/10 in UTC.
    const now = new Date('2026-10-19T00:30:00Z');
    expect(parsePaymentDate('2026-10-18', now)).toBe('2026-10-18');
    expect(() => parsePaymentDate('2026-10-17', now)).toThrow(
      'A data do pagamento não pode ser anterior a hoje.',
    );
    expect(() => parsePaymentDate('2026-02-30', now)).toThrow(
      'Informe a data do pagamento.',
    );
  });
});
