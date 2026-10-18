import {
  dashboardBuckets,
  resolveDashboardRange,
  saoPauloDate,
  saoPauloStart,
} from './dashboard-period';

// 18/10/2026 01:30 UTC is still 17/10 22:30 in São Paulo.
const lateEvening = new Date('2026-10-18T01:30:00Z');

describe('dashboard periods', () => {
  it('counts days in São Paulo time, not in the server clock', () => {
    expect(saoPauloDate(lateEvening)).toBe('2026-10-17');
    expect(saoPauloStart('2026-10-17').toISOString()).toBe(
      '2026-10-17T03:00:00.000Z',
    );
    expect(resolveDashboardRange('today', lateEvening)).toMatchObject({
      startDate: '2026-10-17',
      endDate: '2026-10-17',
      previousStartDate: '2026-10-16',
      previousEndDate: '2026-10-16',
      granularity: 'day',
    });
  });

  it('compares rolling windows with the same number of days right before', () => {
    expect(resolveDashboardRange('7d', lateEvening)).toMatchObject({
      startDate: '2026-10-11',
      endDate: '2026-10-17',
      previousStartDate: '2026-10-04',
      previousEndDate: '2026-10-10',
    });
    expect(resolveDashboardRange('30d', lateEvening)).toMatchObject({
      startDate: '2026-09-18',
      previousStartDate: '2026-08-19',
      previousEndDate: '2026-09-17',
    });
  });

  it('compares this month and this year with the same days before', () => {
    expect(resolveDashboardRange('month', lateEvening)).toMatchObject({
      startDate: '2026-10-01',
      endDate: '2026-10-17',
      previousStartDate: '2026-09-01',
      previousEndDate: '2026-09-17',
      granularity: 'day',
    });
    expect(resolveDashboardRange('year', lateEvening)).toMatchObject({
      startDate: '2026-01-01',
      previousStartDate: '2025-01-01',
      previousEndDate: '2025-10-17',
      granularity: 'month',
    });
    // 31/03 has no counterpart in February: the comparison stops on its last day.
    expect(
      resolveDashboardRange('month', new Date('2026-03-31T15:00:00Z')),
    ).toMatchObject({
      previousStartDate: '2026-02-01',
      previousEndDate: '2026-02-28',
    });
  });

  it('accepts a custom range and refuses incomplete, inverted, future or too long ones', () => {
    expect(
      resolveDashboardRange('custom', lateEvening, {
        startDate: '2026-09-01',
        endDate: '2026-09-30',
      }),
    ).toMatchObject({
      previousStartDate: '2026-08-02',
      previousEndDate: '2026-08-31',
    });
    for (const custom of [
      {},
      { startDate: '2026-09-01' },
      { startDate: '2026-02-30', endDate: '2026-03-01' },
      { startDate: '2026-09-30', endDate: '2026-09-01' },
      { startDate: '2026-10-01', endDate: '2026-10-18' },
      { startDate: '2025-10-01', endDate: '2026-10-17' },
    ])
      expect(() =>
        resolveDashboardRange('custom', lateEvening, custom),
      ).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            code: 'INVALID_DASHBOARD_PERIOD',
          }) as unknown,
        }) as unknown as Error,
      );
  });

  it('lists every day or month of the range, with no gaps', () => {
    expect(
      dashboardBuckets(resolveDashboardRange('7d', lateEvening)),
    ).toHaveLength(7);
    expect(
      dashboardBuckets(resolveDashboardRange('year', lateEvening)),
    ).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
  });
});
