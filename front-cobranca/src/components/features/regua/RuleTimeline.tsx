"use client";
import type { ReactNode } from "react";
import { CalendarCheck, Mail, MessageCircle, Send } from "lucide-react";
import { dayLabel, type RuleDay } from "./rule-days";

type PhaseId = "emission" | "before" | "due" | "after";

const PHASES: Array<{
  id: PhaseId;
  title: string;
  message: string;
  node: string;
  line: string;
  pill: string;
}> = [
  {
    id: "emission",
    title: "Emissão",
    message: "Só quando você pede no cadastro da cobrança.",
    node: "border-2 border-dashed border-slate-300 bg-white text-slate-500",
    line: "bg-slate-200",
    pill: "bg-slate-50 text-slate-600 ring-slate-200",
  },
  {
    id: "before",
    title: "Antes do vencimento",
    message: "Lembrete",
    node: "bg-sky-100 text-sky-800 ring-4 ring-sky-50",
    line: "bg-sky-200",
    pill: "bg-sky-50 text-sky-800 ring-sky-100",
  },
  {
    id: "due",
    title: "No vencimento",
    message: "Vence hoje",
    node: "bg-amber-100 text-amber-900 ring-4 ring-amber-50",
    line: "bg-amber-200",
    pill: "bg-amber-50 text-amber-900 ring-amber-100",
  },
  {
    id: "after",
    title: "Depois do vencimento",
    message:
      "Primeiro atraso, depois Atraso crítico (recorrentes: Atraso recorrente)",
    node: "bg-rose-100 text-rose-800 ring-4 ring-rose-50",
    line: "bg-rose-200",
    pill: "bg-rose-50 text-rose-800 ring-rose-100",
  },
];

function phaseOf(day: number): PhaseId {
  return day < 0 ? "before" : day === 0 ? "due" : "after";
}

function summary(days: RuleDay[]): string {
  if (days.length === 0)
    return "Nenhum contato da régua: só a emissão, se pedida no cadastro.";
  const last = Math.max(...days.map((row) => row.day));
  const end = last > 0 ? `, o último ${dayLabel(last)} o vencimento` : "";
  return `${days.length} ${days.length === 1 ? "contato" : "contatos"} com o cliente${end}.`;
}

/** The rule at a glance: each phase of the charge with its contacts and channels. */
export function RuleTimeline({ days }: { days: RuleDay[] }): ReactNode {
  const sorted = [...days].sort((a, b) => a.day - b.day);
  return (
    <figure className="rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-4 sm:p-5">
      <figcaption className="text-sm font-semibold text-slate-800">
        {summary(sorted)}
      </figcaption>
      <ol
        aria-label="Linha do tempo da régua"
        className="mt-4 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.7fr)]"
      >
        {PHASES.map((phase, index) => {
          const rows = sorted.filter((row) => phaseOf(row.day) === phase.id);
          const detail =
            phase.id === "emission"
              ? phase.message
              : rows.length === 0
                ? "Sem contato"
                : `Mensagem: ${phase.message}`;
          return (
            <li
              key={phase.id}
              aria-label={phase.title}
              className="relative flex gap-3 pb-5 last:pb-0 sm:flex-col sm:items-center sm:gap-2 sm:px-2 sm:pb-0 sm:text-center"
            >
              {index > 0 && (
                <span
                  aria-hidden
                  className={`absolute left-[18px] top-0 h-5 w-1 sm:left-0 sm:top-[18px] sm:h-1 sm:w-1/2 ${phase.line}`}
                />
              )}
              {index < PHASES.length - 1 && (
                <span
                  aria-hidden
                  className={`absolute bottom-0 left-[18px] top-5 w-1 sm:bottom-auto sm:left-1/2 sm:top-[18px] sm:h-1 sm:w-1/2 ${phase.line}`}
                />
              )}
              <span
                aria-hidden
                className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${phase.node}`}
              >
                {phase.id === "emission" ? (
                  <Send size={16} />
                ) : phase.id === "due" && rows.length === 0 ? (
                  <CalendarCheck size={16} />
                ) : (
                  rows.length
                )}
              </span>
              <div className="min-w-0 pt-0.5 sm:pt-0">
                <p className="text-sm font-semibold text-slate-900">
                  {phase.title}
                </p>
                <p className="mt-0.5 text-xs leading-5 text-slate-500">
                  {detail}
                </p>
                {rows.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1.5 sm:justify-center">
                    {rows.map((row) => (
                      <li
                        key={row.key}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${phase.pill}`}
                      >
                        {dayLabel(row.day)}
                        {row.channels.WHATSAPP && (
                          <MessageCircle size={12} aria-label="WhatsApp" />
                        )}
                        {row.channels.EMAIL && (
                          <Mail size={12} aria-label="E-mail" />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
