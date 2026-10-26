import type { RecurrenceFrequency, RecurringInvoice } from "./api-client";

export const RECURRENCE_FREQUENCY_OPTIONS: {
  value: RecurrenceFrequency;
  label: string;
}[] = [
  { value: "WEEKLY", label: "Semanal" },
  { value: "BIWEEKLY", label: "Quinzenal (a cada 14 dias)" },
  { value: "MONTHLY", label: "Mensal" },
  { value: "BIMONTHLY", label: "Bimestral" },
  { value: "QUARTERLY", label: "Trimestral" },
  { value: "SEMIANNUAL", label: "Semestral" },
  { value: "YEARLY", label: "Anual" },
];

const SHORT_LABEL: Record<RecurrenceFrequency, string> = {
  WEEKLY: "Semanal",
  BIWEEKLY: "Quinzenal",
  MONTHLY: "Mensal",
  BIMONTHLY: "Bimestral",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  YEARLY: "Anual",
};

const WEEKDAYS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

/** Weekly ones repeat on a weekday; the others on a day of the month. */
export function isMonthBased(frequency: RecurrenceFrequency): boolean {
  return frequency !== "WEEKLY" && frequency !== "BIWEEKLY";
}

/** "Mensal · dia 10", "Semanal · segunda-feira". */
export function describeSchedule(
  recurrence: Pick<
    RecurringInvoice,
    "frequency" | "dueDay" | "nextDueDate" | "pendingInvoice"
  >,
): string {
  const label = SHORT_LABEL[recurrence.frequency];
  if (isMonthBased(recurrence.frequency)) {
    return `${label} · dia ${recurrence.dueDay}`;
  }
  const date = recurrence.pendingInvoice?.dueDate ?? recurrence.nextDueDate;
  if (!date) return label;
  return `${label} · ${WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]}`;
}

/** Today in São Paulo (YYYY-MM-DD), the earliest first due date. */
export function todayInSaoPaulo(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Sao_Paulo",
  });
}
