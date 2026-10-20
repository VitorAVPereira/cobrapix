"use client";
import { useState } from "react";
import type { ReactNode } from "react";
import {
  Eye,
  Lock,
  Mail,
  MessageCircle,
  MessageSquarePlus,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  MAX_DAY,
  MIN_DAY,
  dayLabel,
  dayMoment,
  type Channel,
  type RuleDay,
} from "./rule-days";

const CHANNELS: Array<{ channel: Channel; label: string; icon: typeof Mail }> =
  [
    { channel: "WHATSAPP", label: "WhatsApp", icon: MessageCircle },
    { channel: "EMAIL", label: "E-mail", icon: Mail },
  ];

/** One contact of the rule: when, by which channels, and which message goes out. */
export function RuleDayCard({
  row,
  disabled,
  onDayChange,
  onToggleChannel,
  onTimeChange,
  onRemove,
  onPreview,
  onRequest,
}: {
  row: RuleDay;
  disabled: boolean;
  onDayChange: (day: number) => void;
  onToggleChannel: (channel: Channel, enabled: boolean) => void;
  onTimeChange: (field: "sendTimeStart" | "sendTimeEnd", value: string) => void;
  onRemove: () => void;
  onPreview: () => void;
  /** Present when the WhatsApp step is saved: a custom template is asked for it. */
  onRequest?: () => void;
}): ReactNode {
  const [dayDraft, setDayDraft] = useState<string | null>(null);
  const sent = Object.values(row.channels).some((step) => step?.attempted);
  const custom = Object.values(row.channels).some(
    (step) => (step?.customTemplates.length ?? 0) > 0,
  );
  const moment = dayMoment(row.day);
  const label = dayLabel(row.day);
  const tone =
    row.day < 0
      ? "bg-sky-50 text-sky-700"
      : row.day === 0
        ? "bg-amber-50 text-amber-800"
        : "bg-rose-50 text-rose-700";

  function commitDay(): void {
    if (dayDraft === null) return;
    const value = Number(dayDraft.replace(",", "."));
    setDayDraft(null);
    if (Number.isInteger(value) && value !== row.day) onDayChange(value);
  }

  return (
    <article
      aria-label={`Contato: ${label}`}
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className={`flex h-12 w-14 shrink-0 flex-col items-center justify-center rounded-lg text-sm font-bold ${tone}`}
          >
            {row.day > 0 ? `+${row.day}` : row.day}
            <span className="text-[10px] font-semibold uppercase">
              {Math.abs(row.day) === 1 ? "dia" : "dias"}
            </span>
          </span>
          <div>
            <p className="font-semibold text-slate-900">{label}</p>
            <p className="text-sm text-slate-600">
              Mensagem:{" "}
              <strong className="font-semibold">{moment.label}</strong>
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {sent && (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  <Lock size={12} /> Já enviada: só é possível remover
                </span>
              )}
              {custom && (
                <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-700">
                  <Sparkles size={12} /> Personalizado pelo suporte
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remover contato: ${label}`}
          className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-red-700 disabled:opacity-50"
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-end">
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
          Dia em relação ao vencimento
          <input
            type="number"
            min={MIN_DAY}
            max={MAX_DAY}
            step={1}
            disabled={disabled || sent}
            value={dayDraft ?? String(row.day)}
            onChange={(event) => setDayDraft(event.target.value)}
            onBlur={commitDay}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitDay();
            }}
            className="h-10 rounded-md border border-slate-300 px-3 text-sm font-normal text-slate-900 disabled:bg-slate-100 disabled:text-slate-500"
          />
        </label>
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Canais do contato {label}</legend>
          {CHANNELS.map(({ channel, label: name, icon: Icon }) => {
            const checked = Boolean(row.channels[channel]);
            return (
              <label
                key={channel}
                className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-medium transition has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 ${
                  checked
                    ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  disabled={disabled}
                  onChange={(event) =>
                    onToggleChannel(channel, event.target.checked)
                  }
                />
                <Icon size={16} aria-hidden /> {name}
              </label>
            );
          })}
        </fieldset>
      </div>

      <p className="mt-3 text-xs text-slate-500">{moment.detail}</p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onPreview}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:underline"
        >
          <Eye size={15} /> Ver mensagem
        </button>
        {onRequest && (
          <button
            type="button"
            onClick={onRequest}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:underline"
          >
            <MessageSquarePlus size={15} /> Pedir mensagem personalizada
          </button>
        )}
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-slate-500">
          Opções avançadas
        </summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Enviar a partir de
            <input
              type="time"
              disabled={disabled}
              value={row.sendTimeStart}
              onChange={(event) =>
                onTimeChange("sendTimeStart", event.target.value)
              }
              className="h-10 rounded-md border border-slate-300 px-3 text-sm font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Enviar até
            <input
              type="time"
              disabled={disabled}
              value={row.sendTimeEnd}
              onChange={(event) =>
                onTimeChange("sendTimeEnd", event.target.value)
              }
              className="h-10 rounded-md border border-slate-300 px-3 text-sm font-normal"
            />
          </label>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          A régua roda às 9h e às 17h. Sem horário, o contato sai na primeira
          rodada do dia.
        </p>
      </details>
    </article>
  );
}
