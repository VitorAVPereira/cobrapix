"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { ArrowLeft, Mail, MessageCircle, MessagesSquare, User } from "lucide-react";
import type { CommunicationChannel, ConversationStatus } from "@/lib/api-client";

export const fieldClass =
  "h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

export const STATUS_LABELS: Record<ConversationStatus, string> = {
  NEW: "Novo",
  IN_PROGRESS: "Em atendimento",
  CLOSED: "Concluído",
};

export const STATUS_TONES: Record<ConversationStatus, string> = {
  NEW: "border-sky-200 bg-sky-50 text-sky-700",
  IN_PROGRESS: "border-amber-200 bg-amber-50 text-amber-700",
  CLOSED: "border-slate-200 bg-slate-100 text-slate-500",
};

const SAO_PAULO = "America/Sao_Paulo";

function dayKey(value: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SAO_PAULO }).format(new Date(value));
}

/** "14:32" today, "Ontem", or "18/10" (with the year when it is another one). */
export function shortTime(value: string, now = new Date()): string {
  const date = new Date(value);
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000));
  const key = dayKey(date);
  if (key === today)
    return new Intl.DateTimeFormat("pt-BR", { timeZone: SAO_PAULO, hour: "2-digit", minute: "2-digit" }).format(date);
  if (key === yesterday) return "Ontem";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: SAO_PAULO,
    day: "2-digit",
    month: "2-digit",
    ...(key.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}),
  }).format(date);
}

/** Separator between days of a conversation: "Hoje", "Ontem" or "18 de outubro de 2026". */
export function dayLabel(value: string, now = new Date()): string {
  const key = dayKey(value);
  if (key === dayKey(now)) return "Hoje";
  if (key === dayKey(new Date(now.getTime() - 86_400_000))) return "Ontem";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: SAO_PAULO, dateStyle: "long" }).format(new Date(value));
}

export function messageTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: SAO_PAULO, hour: "2-digit", minute: "2-digit" }).format(
    new Date(value),
  );
}

export { dayKey };

export function Avatar({ name }: { name: string }) {
  const initials =
    name
      .replace(/[^\p{L}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("");
  return (
    <span
      aria-hidden
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-800"
    >
      {initials || <User size={18} />}
    </span>
  );
}

export function ChannelBadge({ channel }: { channel: CommunicationChannel }) {
  const whatsapp = channel === "WHATSAPP";
  const Icon = whatsapp ? MessageCircle : Mail;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
      <Icon size={13} className={whatsapp ? "text-emerald-600" : "text-sky-600"} />
      {whatsapp ? "WhatsApp" : "E-mail"}
    </span>
  );
}

export function StatusChip({ status }: { status: ConversationStatus }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_TONES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

/** One conversation in the list; its accessible name starts with the contact. */
export function ConversationListItem({
  active,
  title,
  subtitle,
  preview,
  time,
  channel,
  unread = 0,
  chips,
  onClick,
}: {
  active: boolean;
  title: string;
  subtitle?: string | null;
  preview?: string | null;
  time?: string | null;
  channel: CommunicationChannel;
  unread?: number;
  chips?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex w-full gap-3 border-l-[3px] px-4 py-3 text-left transition ${
        active ? "border-emerald-500 bg-emerald-50/70" : "border-transparent hover:bg-slate-50"
      }`}
    >
      <Avatar name={title} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={`truncate text-sm ${unread > 0 ? "font-semibold text-slate-900" : "font-medium text-slate-800"}`}>
            {title}
          </span>
          {time && (
            <span className={`shrink-0 text-xs ${unread > 0 ? "font-semibold text-emerald-700" : "text-slate-400"}`}>
              {shortTime(time)}
            </span>
          )}
        </span>
        {subtitle && <span className="block truncate text-xs text-slate-500">{subtitle}</span>}
        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span className="truncate text-sm text-slate-500">{preview || "Sem mensagens"}</span>
          {unread > 0 && (
            <span className="shrink-0 rounded-full bg-emerald-600 px-1.5 text-[11px] font-semibold leading-5 text-white">
              {unread}
              <span className="sr-only"> novas</span>
            </span>
          )}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <ChannelBadge channel={channel} />
          {chips}
        </span>
      </span>
    </button>
  );
}

/**
 * Two panes with their own scroll: the list and the open conversation. On phones only
 * one shows at a time, with a way back to the list.
 */
export function InboxShell({
  toolbar,
  list,
  detail,
  open,
}: {
  toolbar: ReactNode;
  list: ReactNode;
  detail: ReactNode | null;
  open: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      {/* While a conversation is open on a narrow screen, it gets the space of the filters. */}
      <div className={`border-b border-slate-200 p-3 ${open ? "hidden xl:block" : ""}`}>{toolbar}</div>
      <div className="grid h-[calc(100dvh-12rem)] min-h-[28rem] xl:h-[calc(100vh-17rem)] xl:grid-cols-[22rem_minmax(0,1fr)]">
        <div className={`min-h-0 flex-col border-slate-200 xl:flex xl:border-r ${open ? "hidden" : "flex"}`}>{list}</div>
        <div className={`min-h-0 flex-col bg-slate-50/60 xl:flex ${open ? "flex" : "hidden"}`}>
          {detail ?? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-slate-500">
              <MessagesSquare size={32} className="text-slate-300" />
              <p className="text-sm">Selecione uma conversa para ver as mensagens.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function BackToList({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Voltar às conversas"
      className="-ml-1 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 xl:hidden"
    >
      <ArrowLeft size={18} />
    </button>
  );
}

/**
 * Keeps the newest message in view: on opening a conversation, and when new messages
 * arrive while the reader is already near the end (reading older ones is not disturbed).
 */
export function useStickToBottom(
  ref: RefObject<HTMLElement | null>,
  conversationId: string | null,
  lastMessageId: string | null,
) {
  const opened = useRef<string | null>(null);
  const nearEnd = useRef(true);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const onScroll = () => {
      nearEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
    };
    element.addEventListener("scroll", onScroll);
    return () => element.removeEventListener("scroll", onScroll);
  }, [ref]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !lastMessageId) return;
    if (opened.current !== conversationId || nearEnd.current) {
      element.scrollTop = element.scrollHeight;
      opened.current = conversationId;
      nearEnd.current = true;
    }
  }, [ref, conversationId, lastMessageId]);
}
