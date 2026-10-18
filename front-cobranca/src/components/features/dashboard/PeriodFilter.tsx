"use client";

import { useState } from "react";
import { CalendarRange } from "lucide-react";
import type { DashboardPeriod } from "@/lib/api-client";

export interface DashboardQuery {
  period: DashboardPeriod;
  startDate?: string;
  endDate?: string;
}

const PRESETS: { period: Exclude<DashboardPeriod, "custom">; label: string }[] = [
  { period: "today", label: "Hoje" },
  { period: "7d", label: "7 dias" },
  { period: "30d", label: "30 dias" },
  { period: "month", label: "Este mês" },
  { period: "year", label: "Este ano" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today in São Paulo, the calendar the API counts periods in. */
export function saoPauloToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}

function rangeError(startDate: string, endDate: string): string | null {
  if (!startDate || !endDate) return "Informe a data inicial e a final.";
  if (endDate < startDate) return "A data final deve ser igual ou posterior à inicial.";
  if (endDate > saoPauloToday()) return "O período não pode terminar no futuro.";
  const days = (Date.parse(endDate) - Date.parse(startDate)) / DAY_MS + 1;
  if (days > 366) return "Escolha um período de até 366 dias.";
  return null;
}

export function PeriodFilter({
  value,
  onChange,
}: {
  value: DashboardQuery;
  onChange: (query: DashboardQuery) => void;
}) {
  const [customOpen, setCustomOpen] = useState(value.period === "custom");
  const [startDate, setStartDate] = useState(value.startDate ?? "");
  const [endDate, setEndDate] = useState(value.endDate ?? "");
  const [error, setError] = useState<string | null>(null);

  function apply(): void {
    const problem = rangeError(startDate, endDate);
    setError(problem);
    if (!problem) onChange({ period: "custom", startDate, endDate });
  }

  const buttonClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
      active
        ? "bg-slate-900 text-white shadow-sm"
        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    }`;

  return (
    <div className="flex shrink-0 flex-col items-start gap-2 xl:items-end">
      <div
        role="group"
        aria-label="Período"
        className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1"
      >
        {PRESETS.map((preset) => (
          <button
            key={preset.period}
            type="button"
            aria-pressed={value.period === preset.period}
            onClick={() => {
              setCustomOpen(false);
              setError(null);
              onChange({ period: preset.period });
            }}
            className={buttonClass(value.period === preset.period)}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={value.period === "custom"}
          aria-expanded={customOpen}
          onClick={() => setCustomOpen((open) => !open)}
          className={`inline-flex items-center gap-1.5 ${buttonClass(value.period === "custom")}`}
        >
          <CalendarRange size={15} aria-hidden="true" />
          Personalizado
        </button>
      </div>

      {customOpen && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
          className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3"
        >
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
            De
            <input
              type="date"
              value={startDate}
              max={saoPauloToday()}
              onChange={(event) => setStartDate(event.target.value)}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
            Até
            <input
              type="date"
              value={endDate}
              max={saoPauloToday()}
              onChange={(event) => setEndDate(event.target.value)}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-900"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Aplicar
          </button>
          {error && (
            <p role="alert" className="w-full text-xs text-rose-600">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
