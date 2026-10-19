import { BadRequestException } from '@nestjs/common';
import {
  addDays,
  saoPauloDate,
  saoPauloStart,
} from '../billing/dashboard-period';

export type ScheduleUnit = 'DAY' | 'WEEK' | 'MONTH';

/** The approval request of a scheduled payment goes out at 08:00 in São Paulo. */
const REQUEST_HOUR_MS = 8 * 60 * 60 * 1000;

/** Calendar date (São Paulo) of a `@db.Date` column, which Prisma reads as UTC midnight. */
export function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** `@db.Date` value for a São Paulo calendar date. */
export function toDbDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** The approval of a request made on a date is valid until 23:59 of that date. */
export function endOfSaoPauloDay(date: string): Date {
  return new Date(saoPauloStart(addDays(date, 1)).getTime() - 1);
}

export function requestTimeReached(date: string, now: Date): boolean {
  return now.getTime() >= saoPauloStart(date).getTime() + REQUEST_HOUR_MS;
}

function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Date of occurrence `n` (1 = first). Always counted from the first date, so a payment on
 * day 31 is paid on the last day of shorter months and on day 31 again after them.
 */
export function occurrenceDate(
  firstDate: string,
  unit: ScheduleUnit,
  every: number,
  n: number,
): string {
  const steps = (n - 1) * every;
  if (unit === 'DAY') return addDays(firstDate, steps);
  if (unit === 'WEEK') return addDays(firstDate, steps * 7);
  const year = Number(firstDate.slice(0, 4));
  const month = Number(firstDate.slice(5, 7)) - 1 + steps;
  const day = Number(firstDate.slice(8, 10));
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const target = Math.min(day, lastDayOfMonth(targetYear, targetMonth));
  return new Date(Date.UTC(targetYear, targetMonth, target))
    .toISOString()
    .slice(0, 10);
}

/** Whether occurrence `n` still belongs to the repetition the user chose. */
export function withinSchedule(
  schedule: { endsOn: string | null; maxOccurrences: number | null },
  n: number,
  date: string,
): boolean {
  if (schedule.maxOccurrences !== null && n > schedule.maxOccurrences)
    return false;
  if (schedule.endsOn !== null && date > schedule.endsOn) return false;
  return true;
}

/** A payment can be scheduled for today (requested right away) or a later date. */
export function parsePaymentDate(value: string, now: Date): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw new BadRequestException({
      code: 'PAYMENT_DATE_INVALID',
      message: 'Informe a data do pagamento.',
    });
  if (value < saoPauloDate(now))
    throw new BadRequestException({
      code: 'PAYMENT_DATE_PAST',
      message: 'A data do pagamento não pode ser anterior a hoje.',
    });
  return value;
}

export { saoPauloDate };
