import { BadRequestException } from '@nestjs/common';

export const DASHBOARD_PERIODS = [
  'today',
  '7d',
  '30d',
  'month',
  'year',
  'custom',
] as const;
export type DashboardPeriodKey = (typeof DASHBOARD_PERIODS)[number];

export interface DashboardRange {
  key: DashboardPeriodKey;
  /** Calendar dates in São Paulo, inclusive. */
  startDate: string;
  endDate: string;
  previousStartDate: string;
  previousEndDate: string;
  granularity: 'day' | 'month';
}

const DAY_MS = 24 * 60 * 60 * 1000;
// Brazil dropped daylight saving time in 2019, so São Paulo is a fixed UTC-3.
const SAO_PAULO_OFFSET_MS = 3 * 60 * 60 * 1000;
const MAX_CUSTOM_DAYS = 366;
const MAX_DAILY_DAYS = 62;

function invalid(message: string): BadRequestException {
  return new BadRequestException({ code: 'INVALID_DASHBOARD_PERIOD', message });
}

/** São Paulo calendar date of an instant. */
export function saoPauloDate(instant: Date): string {
  return new Date(instant.getTime() - SAO_PAULO_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

/** First instant of a São Paulo calendar date. */
export function saoPauloStart(date: string): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) + SAO_PAULO_OFFSET_MS);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export function daysBetween(start: string, end: string): number {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
      DAY_MS,
  );
}

function shiftMonths(date: string, months: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

function parseDate(value: string | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalid('Informe as datas no formato AAAA-MM-DD.');
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw invalid('Data inválida.');
  }
  return value;
}

export function resolveDashboardRange(
  key: DashboardPeriodKey,
  now: Date,
  custom: { startDate?: string; endDate?: string } = {},
): DashboardRange {
  const today = saoPauloDate(now);
  let startDate: string;
  let endDate = today;
  let previous: ((date: string) => string) | undefined;

  switch (key) {
    case 'today':
      startDate = today;
      break;
    case '7d':
      startDate = addDays(today, -6);
      break;
    case '30d':
      startDate = addDays(today, -29);
      break;
    case 'month':
      startDate = `${today.slice(0, 7)}-01`;
      previous = (date) => shiftMonths(date, -1);
      break;
    case 'year':
      startDate = `${today.slice(0, 4)}-01-01`;
      previous = (date) => shiftMonths(date, -12);
      break;
    case 'custom':
      startDate = parseDate(custom.startDate);
      endDate = parseDate(custom.endDate);
      if (endDate < startDate) {
        throw invalid('A data final deve ser igual ou posterior à inicial.');
      }
      if (endDate > today) {
        throw invalid('O período não pode terminar no futuro.');
      }
      if (daysBetween(startDate, endDate) + 1 > MAX_CUSTOM_DAYS) {
        throw invalid('Escolha um período de até 366 dias.');
      }
      break;
  }

  const length = daysBetween(startDate, endDate) + 1;
  previous ??= (date) => addDays(date, -length);
  // Same-length window right before; month and year compare the same days
  // of the previous month or year instead.
  const previousStartDate = previous(startDate);
  const previousEndDate =
    key === 'month' || key === 'year'
      ? previous(endDate)
      : addDays(startDate, -1);

  return {
    key,
    startDate,
    endDate,
    previousStartDate,
    previousEndDate,
    granularity: length > MAX_DAILY_DAYS ? 'month' : 'day',
  };
}

/** Every bucket of the range, so the chart has no gaps. */
export function dashboardBuckets(range: DashboardRange): string[] {
  const buckets: string[] = [];
  if (range.granularity === 'day') {
    for (let date = range.startDate; date <= range.endDate; ) {
      buckets.push(date);
      date = addDays(date, 1);
    }
    return buckets;
  }
  for (
    let month = range.startDate.slice(0, 7);
    month <= range.endDate.slice(0, 7);
  ) {
    buckets.push(month);
    month = shiftMonths(`${month}-01`, 1).slice(0, 7);
  }
  return buckets;
}
