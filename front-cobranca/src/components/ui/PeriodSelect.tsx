"use client";

import { useState } from "react";
import type { DashboardPeriod } from "@/lib/api-client";
import { rangeError } from "@/components/features/dashboard/PeriodFilter";

export interface PeriodValue {
  /** "" is any date. */
  period: DashboardPeriod | "";
  startDate: string;
  endDate: string;
}

const PERIOD_OPTIONS: { value: DashboardPeriod | ""; label: string }[] = [
  { value: "", label: "Qualquer data" },
  { value: "today", label: "Pagas hoje" },
  { value: "7d", label: "Últimos 7 dias" },
  { value: "30d", label: "Últimos 30 dias" },
  { value: "month", label: "Este mês" },
  { value: "year", label: "Este ano" },
  { value: "custom", label: "Escolher datas" },
];

export const PERIOD_VALUES = PERIOD_OPTIONS.map((option) => option.value);

const fieldClass =
  "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

/**
 * Payment date filter of a list: presets, or two dates applied together.
 * Renders the select and, when chosen, a row of dates spanning the filter grid.
 */
export function PeriodSelect({
  value,
  onChange,
  datesClassName,
}: {
  value: PeriodValue;
  onChange: (next: PeriodValue) => void;
  /** Grid placement of the dates row, e.g. "md:col-span-2 xl:col-span-4". */
  datesClassName: string;
}) {
  const [customOpen, setCustomOpen] = useState(value.period === "custom");
  const [startDate, setStartDate] = useState(value.startDate);
  const [endDate, setEndDate] = useState(value.endDate);
  const [error, setError] = useState<string | null>(null);
  // A reset from outside (e.g. "Limpar filtros") closes the dates row.
  const [lastPeriod, setLastPeriod] = useState(value.period);
  if (value.period !== lastPeriod) {
    setLastPeriod(value.period);
    setCustomOpen(value.period === "custom");
  }

  function choose(period: DashboardPeriod | ""): void {
    setError(null);
    if (period === "custom") {
      setCustomOpen(true);
      return;
    }
    setCustomOpen(false);
    onChange({ period, startDate: "", endDate: "" });
  }

  function apply(): void {
    const problem = rangeError(startDate, endDate);
    setError(problem);
    if (!problem) onChange({ period: "custom", startDate, endDate });
  }

  return (
    <>
      <label>
        <span className="sr-only">Filtrar por data do pagamento</span>
        <select
          value={customOpen ? "custom" : value.period}
          onChange={(event) => choose(event.target.value as PeriodValue["period"])}
          className={fieldClass}
        >
          {PERIOD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {customOpen && (
        <div className={`flex flex-col gap-2 ${datesClassName}`}>
          <div className="flex flex-wrap items-end gap-2 text-sm">
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
              Pagas de
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className={`${fieldClass} w-auto`}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
              até
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className={`${fieldClass} w-auto`}
              />
            </label>
            <button
              type="button"
              onClick={apply}
              className="h-10 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Aplicar
            </button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-rose-600">
              {error}
            </p>
          )}
        </div>
      )}
    </>
  );
}

/** A custom period only counts with a valid range; otherwise it is ignored. */
export function readPeriod(
  params: URLSearchParams,
  fallback: DashboardPeriod | "",
  anyValue: string | null,
): PeriodValue {
  const raw = params.get("period");
  const known = PERIOD_VALUES.find((value) => value !== "" && value === raw);
  const period: DashboardPeriod | "" =
    raw === null ? fallback : anyValue !== null && raw === anyValue ? "" : (known ?? fallback);
  if (period !== "custom") return { period, startDate: "", endDate: "" };
  const startDate = params.get("startDate") ?? "";
  const endDate = params.get("endDate") ?? "";
  return rangeError(startDate, endDate) === null
    ? { period, startDate, endDate }
    : { period: fallback, startDate: "", endDate: "" };
}

/** Writes the period to the URL, omitting the page's default. */
export function writePeriod(
  params: URLSearchParams,
  value: PeriodValue,
  fallback: DashboardPeriod | "",
  anyValue: string | null,
): void {
  if (value.period === fallback) return;
  params.set("period", value.period === "" ? (anyValue ?? "") : value.period);
  if (value.period === "custom") {
    params.set("startDate", value.startDate);
    params.set("endDate", value.endDate);
  }
}
