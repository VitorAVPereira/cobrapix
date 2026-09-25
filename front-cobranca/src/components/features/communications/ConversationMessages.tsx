"use client";
import type { ReactNode } from "react";
import type { ConversationMessage } from "@/lib/api-client";
import { formatDateTime, formatInvoice, statusLabel } from "./format";
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
 * Chronological list shared by the company and admin screens. Only fields present in the
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
        <button
          className="w-full rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
          disabled={loadingOlder}
          onClick={onLoadOlder}
        >
          {loadingOlder ? "Carregando…" : "Carregar mensagens anteriores"}
        </button>
      )}
      {messages.length === 0 && (
        <p className="rounded-lg border p-4 text-sm text-slate-500">
          Nenhuma mensagem nesta conversa.
        </p>
      )}
      <ol className="space-y-3" aria-label="Mensagens">
        {messages.map((message) => (
          <li
            key={message.id}
            className={`rounded-lg p-3 text-sm ${message.direction === "INBOUND" ? "mr-8 bg-slate-100" : "ml-8 bg-emerald-50"}`}
          >
            <p className="text-xs font-medium text-slate-600">
              {message.direction === "INBOUND" ? "Recebida" : "Enviada"}
              {message.messageType && TYPE_LABELS[message.messageType]
                ? ` · ${TYPE_LABELS[message.messageType]}`
                : ""}
            </p>
            {message.replyTo && (
              <blockquote className="mt-2 border-l-4 border-slate-300 pl-2 text-xs text-slate-600">
                {message.replyTo.excerpt}
              </blockquote>
            )}
            <p className="mt-1 whitespace-pre-wrap">{message.content}</p>
            {message.attachments.map((attachment) => (
              <MessageAttachment
                key={attachment.id}
                messageId={message.id}
                attachment={attachment}
              />
            ))}
            <p className="mt-2 text-xs text-slate-500">
              {formatDateTime(message.createdAt)} ·{" "}
              {statusLabel(message.status)}
            </p>
            {message.invoice && (
              <p className="mt-1 text-xs text-slate-600">
                {formatInvoice(message.invoice)}
                {message.debtor ? ` · ${message.debtor.name}` : ""}
              </p>
            )}
            {renderDetails?.(message)}
          </li>
        ))}
      </ol>
    </div>
  );
}
