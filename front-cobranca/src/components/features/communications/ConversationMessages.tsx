"use client";
import { Fragment } from "react";
import type { ReactNode } from "react";
import { Loader2, Receipt } from "lucide-react";
import type { ConversationMessage } from "@/lib/api-client";
import { formatInvoice, statusLabel } from "./format";
import { dayKey, dayLabel, messageTime } from "./InboxParts";
import { MessageAttachment } from "./MessageAttachment";

const TYPE_LABELS: Record<string, string> = {
  image: "Imagem",
  audio: "Áudio",
  video: "Vídeo",
  document: "Documento",
  sticker: "Figurinha",
  location: "Localização",
  contacts: "Contato",
  reaction: "Reação",
  button: "Resposta de botão",
  interactive: "Resposta de botão",
  template: "Template",
};

/**
 * Chronological chat shared by the company and admin screens. Only fields present in the
 * API response are shown; nothing is inferred from other cached conversations.
 */
export function ConversationMessages<T extends ConversationMessage>({
  messages,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  renderDetails,
}: {
  /** Oldest first. */
  messages: T[];
  hasOlder: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
  /** Admin-only context and actions for one message. */
  renderDetails?: (message: T) => ReactNode;
}): ReactNode {
  return (
    <div className="space-y-3">
      {hasOlder && onLoadOlder && (
        <div className="flex justify-center">
          <button
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            disabled={loadingOlder}
            onClick={onLoadOlder}
          >
            {loadingOlder && <Loader2 size={13} className="animate-spin" />}
            {loadingOlder ? "Carregando…" : "Carregar mensagens anteriores"}
          </button>
        </div>
      )}
      {messages.length === 0 && (
        <p className="py-8 text-center text-sm text-slate-500">Nenhuma mensagem nesta conversa.</p>
      )}
      <ol className="space-y-2" aria-label="Mensagens">
        {messages.map((message, index) => {
          const inbound = message.direction === "INBOUND";
          const newDay = index === 0 || dayKey(messages[index - 1]!.createdAt) !== dayKey(message.createdAt);
          const type = message.messageType ? TYPE_LABELS[message.messageType] : undefined;
          return (
            <Fragment key={message.id}>
              {newDay && (
                <li aria-hidden className="flex justify-center py-1">
                  <span className="rounded-full bg-white px-3 py-0.5 text-[11px] font-medium text-slate-500 shadow-sm ring-1 ring-slate-200">
                    {dayLabel(message.createdAt)}
                  </span>
                </li>
              )}
              <li className={`flex ${inbound ? "justify-start" : "justify-end"}`}>
                <div
                  // Long unbroken text (payment codes, URLs) wraps inside the bubble;
                  // the content itself, and what is copied from it, is untouched.
                  className={`min-w-0 max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-sm wrap-anywhere sm:max-w-[75%] ${
                    inbound
                      ? "rounded-bl-md bg-white text-slate-800 ring-1 ring-slate-200"
                      : "rounded-br-md bg-emerald-50 text-slate-800 ring-1 ring-emerald-100"
                  }`}
                >
                  <p className="sr-only">{inbound ? "Recebida" : "Enviada"}</p>
                  {type && <p className="mb-0.5 text-[11px] font-medium text-slate-500">{type}</p>}
                  {message.replyTo && (
                    <blockquote className="mb-1.5 whitespace-pre-wrap rounded-md border-l-4 border-emerald-400 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                      {message.replyTo.excerpt}
                    </blockquote>
                  )}
                  <p className="whitespace-pre-wrap">{message.content}</p>
                  {message.attachments.map((attachment) => (
                    <MessageAttachment key={attachment.id} messageId={message.id} attachment={attachment} />
                  ))}
                  {message.invoice && (
                    <p className="mt-1.5 flex items-start gap-1.5 rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-600">
                      <Receipt size={13} className="mt-0.5 shrink-0 text-slate-400" />
                      <span>
                        {formatInvoice(message.invoice)}
                        {message.debtor ? ` · ${message.debtor.name}` : ""}
                      </span>
                    </p>
                  )}
                  <p className="mt-1 text-right text-[11px] text-slate-400">
                    {messageTime(message.createdAt)}
                    {!inbound && ` · ${statusLabel(message.status)}`}
                  </p>
                  {renderDetails?.(message)}
                </div>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
}
