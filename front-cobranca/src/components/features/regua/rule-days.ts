import type { CollectionRuleStep, RuleStepInput } from "@/lib/api-client";
import type { CollectionPurpose } from "@/components/features/templates/types";

export type Channel = "WHATSAPP" | "EMAIL";

/** Earliest day of a rule step: before it the emission message (asked at registration) applies. */
export const MIN_DAY = -29;
export const MAX_DAY = 365;
/** Days offered as shortcuts when adding a contact. */
export const DAY_SHORTCUTS = [-3, 0, 1, 3, 7, 15, 30] as const;

export interface DayStep {
  /** Saved step; absent while it exists only on screen. */
  id?: string;
  /** Some invoice already got it: day and channel are fixed. */
  attempted: boolean;
  customTemplates: CollectionRuleStep["customTemplates"];
}

/** One contact of the rule: a day and the channels that send on it. */
export interface RuleDay {
  key: string;
  day: number;
  channels: Partial<Record<Channel, DayStep>>;
  sendTimeStart: string;
  sendTimeEnd: string;
}

let keySequence = 0;
export function newDayKey(): string {
  keySequence += 1;
  return `day-${keySequence}`;
}

/** Steps of a profile grouped by day. "Inicial" steps (day <= -30) are history and stay out. */
export function toRuleDays(steps: CollectionRuleStep[]): RuleDay[] {
  const days = new Map<number, RuleDay>();
  for (const step of [...steps].sort((a, b) => a.stepOrder - b.stepOrder)) {
    if (!step.isActive || step.scheduleDay < MIN_DAY) continue;
    const row =
      days.get(step.scheduleDay) ??
      ({
        key: `saved-${step.id}`,
        day: step.scheduleDay,
        channels: {},
        sendTimeStart: step.sendTimeStart ?? "",
        sendTimeEnd: step.sendTimeEnd ?? "",
      } satisfies RuleDay);
    row.channels[step.channel] = {
      id: step.id,
      attempted: step.attempted,
      customTemplates: step.customTemplates,
    };
    days.set(step.scheduleDay, row);
  }
  return [...days.values()].sort((a, b) => a.day - b.day);
}

/** What is sent back: one step per channel, in day order, with the delay since the previous one. */
export function toStepInputs(days: RuleDay[]): RuleStepInput[] {
  const inputs: RuleStepInput[] = [];
  let previous = 0;
  for (const row of [...days].sort((a, b) => a.day - b.day)) {
    for (const channel of ["WHATSAPP", "EMAIL"] as const) {
      const step = row.channels[channel];
      if (!step) continue;
      inputs.push({
        ...(step.id ? { id: step.id } : {}),
        stepOrder: inputs.length,
        channel,
        delayDays: row.day - previous,
        ...(row.sendTimeStart ? { sendTimeStart: row.sendTimeStart } : {}),
        ...(row.sendTimeEnd ? { sendTimeEnd: row.sendTimeEnd } : {}),
      });
      previous = row.day;
    }
  }
  return inputs;
}

/** First problem that keeps the schedule from being saved, in plain words. */
export function scheduleProblem(days: RuleDay[]): string | null {
  for (const row of days) {
    const label = dayLabel(row.day);
    if (!Number.isInteger(row.day) || row.day < MIN_DAY || row.day > MAX_DAY)
      return `O contato “${label}” precisa estar entre ${-MIN_DAY} dias antes e ${MAX_DAY} dias após o vencimento.`;
    if (!row.channels.WHATSAPP && !row.channels.EMAIL)
      return `Escolha WhatsApp, e-mail ou os dois no contato “${label}”.`;
    if (Boolean(row.sendTimeStart) !== Boolean(row.sendTimeEnd))
      return `Preencha os dois horários do contato “${label}” ou deixe ambos vazios.`;
    if (
      row.sendTimeStart &&
      row.sendTimeEnd &&
      row.sendTimeStart > row.sendTimeEnd
    )
      return `No contato “${label}”, o horário inicial deve ser anterior ao final.`;
  }
  if (toStepInputs(days).length > 20) return "A régua aceita até 20 envios.";
  return null;
}

export function dayLabel(day: number): string {
  if (day === 0) return "Dia do vencimento";
  const count = Math.abs(day);
  return `${count} ${count === 1 ? "dia" : "dias"} ${day < 0 ? "antes" : "após"}`;
}

export function shortcutLabel(day: number): string {
  if (day === 0) return "No vencimento";
  return day < 0 ? `${day} dias` : `+${day} ${day === 1 ? "dia" : "dias"}`;
}

/** Message of a day, as chosen when sending (the overdue one depends on the invoice). */
export function dayMoment(day: number): {
  purpose: CollectionPurpose;
  label: string;
  detail: string;
} {
  if (day < 0)
    return {
      purpose: "BEFORE_DUE",
      label: "Lembrete",
      detail: "Mensagem de lembrete antes do vencimento.",
    };
  if (day === 0)
    return {
      purpose: "DUE_TODAY",
      label: "Vence hoje",
      detail: "Mensagem do dia do vencimento.",
    };
  return {
    purpose: "FIRST_OVERDUE",
    label: "Atraso",
    detail:
      "Primeiro atraso na primeira mensagem após o vencimento, depois Atraso crítico. Faturas recorrentes recebem Atraso recorrente.",
  };
}
