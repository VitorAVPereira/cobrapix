"use client";
import type { ReactNode } from "react";
import { Mail, MessageCircle, Send } from "lucide-react";

export interface SendNowValue {
  sendNow: boolean;
  whatsapp: boolean;
  email: boolean;
}

/** Starts as the company's "primeira cobrança" setting; WhatsApp is the usual channel. */
export function initialSendNow(
  companyDefault: boolean | undefined,
): SendNowValue {
  return { sendNow: companyDefault ?? true, whatsapp: true, email: false };
}

/** The emission choice as the API reads it; nothing is sent when the user declines. */
export function sendNowPayload(value: SendNowValue): {
  send_now: boolean;
  send_channels?: Array<"WHATSAPP" | "EMAIL">;
} {
  if (!value.sendNow) return { send_now: false };
  return {
    send_now: true,
    send_channels: [
      ...(value.whatsapp ? (["WHATSAPP"] as const) : []),
      ...(value.email ? (["EMAIL"] as const) : []),
    ],
  };
}

export function sendNowProblem(value: SendNowValue): string | null {
  return value.sendNow && !value.whatsapp && !value.email
    ? "Escolha WhatsApp, e-mail ou os dois para enviar a cobrança agora."
    : null;
}

/** "Enviar cobrança agora": the emission message goes out only when asked here. */
export function SendNowFields({
  value,
  onChange,
  disabled,
  many = false,
}: {
  value: SendNowValue;
  onChange: (value: SendNowValue) => void;
  disabled?: boolean;
  /** Wording for an import with several invoices. */
  many?: boolean;
}): ReactNode {
  return (
    <fieldset className="space-y-2 rounded-md border border-slate-200 p-3">
      <legend className="sr-only">Envio da cobrança</legend>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.sendNow}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...value, sendNow: event.target.checked })
          }
          className="mt-0.5 h-4 w-4 rounded border-slate-300"
        />
        <span>
          <span className="flex items-center gap-1.5 font-medium text-slate-800">
            <Send size={14} aria-hidden /> Enviar{" "}
            {many ? "as cobranças" : "cobrança"} agora
          </span>
          <span className="block text-xs text-slate-500">
            {value.sendNow
              ? "A mensagem de emissão sai assim que a cobrança for gerada."
              : "Sem envio agora: o cliente recebe só os contatos da régua de cobrança."}
          </span>
        </span>
      </label>
      {value.sendNow && (
        <div className="flex flex-wrap gap-2 pl-6">
          <label className="inline-flex items-center gap-1.5 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={value.whatsapp}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...value, whatsapp: event.target.checked })
              }
              className="h-4 w-4 rounded border-slate-300"
            />
            <MessageCircle size={14} aria-hidden /> WhatsApp
          </label>
          <label className="inline-flex items-center gap-1.5 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={value.email}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...value, email: event.target.checked })
              }
              className="h-4 w-4 rounded border-slate-300"
            />
            <Mail size={14} aria-hidden /> E-mail
          </label>
        </div>
      )}
    </fieldset>
  );
}
