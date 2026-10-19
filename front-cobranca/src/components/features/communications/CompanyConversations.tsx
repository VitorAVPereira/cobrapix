"use client";
import { useCallback, useRef, useState } from "react";
import { Eye } from "lucide-react";
import type { ReactNode } from "react";
import type {
  CommunicationChannel,
  CompanyConversation,
  CompanyConversationMessages,
  ConversationMessage,
} from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";
import { formatWhatsAppNumber } from "@/lib/whatsapp-number";
import { useVisiblePolling } from "@/lib/use-visible-polling";
import { ListPagination } from "@/components/ui/ListPagination";
import { SearchForm } from "@/components/ui/SearchForm";
import { ConversationMessages } from "./ConversationMessages";
import { errorMessage, isAbort } from "./format";
import {
  Avatar,
  BackToList,
  ChannelBadge,
  ConversationListItem,
  InboxShell,
  fieldClass,
  useStickToBottom,
} from "./InboxParts";

const LIST_PAGE_SIZE = 10;

/** A WhatsApp contact reads as a phone number; an e-mail stays as it is. */
function address(channel: CommunicationChannel, value: string | null | undefined): string | null {
  if (!value) return null;
  return channel === "WHATSAPP" && /^\d{10,15}$/.test(value) ? formatWhatsAppNumber(value) : value;
}
const MESSAGE_PAGE_SIZE = 25;

/** Newest page merged into what is loaded, oldest first, without duplicates. */
function mergeMessages(
  loaded: ConversationMessage[],
  page: ConversationMessage[],
): ConversationMessage[] {
  const byId = new Map(loaded.map((message) => [message.id, message]));
  for (const message of page) byId.set(message.id, message);
  return [...byId.values()].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

/**
 * Read-only company projection. Mount it with a key per session user/company so a new
 * login never shows the previous company's cached conversations.
 */
export function CompanyConversations(): ReactNode {
  const api = useApiClient();
  const [channel, setChannel] = useState<CommunicationChannel | "">("");
  const [search, setSearch] = useState("");
  const [conversations, setConversations] = useState<CompanyConversation[]>(
    [],
  );
  // Server cursors of pages 2..n: the signed cursor stays the only way to move forward.
  const [cursors, setCursors] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [header, setHeader] = useState<
    CompanyConversationMessages["conversation"] | null
  >(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Once older messages are loaded, polling only refreshes the newest page and keeps them.
  const pagedMessages = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  useStickToBottom(scroller, selectedId, messages.at(-1)?.id ?? null);

  const refresh = useCallback(
    async (signal: AbortSignal): Promise<void> => {
      try {
        const [list, threadResult] = await Promise.all([
          api.listCompanyConversations(
            {
              limit: LIST_PAGE_SIZE,
              channel: channel || undefined,
              search: search || undefined,
              cursor: cursors.at(-1),
            },
            signal,
          ),
          selectedId
            ? api
                .listCompanyConversationMessages(
                  selectedId,
                  { limit: MESSAGE_PAGE_SIZE },
                  signal,
                )
                .then(
                  (value) => ({ value, failure: null }),
                  (failure: unknown) => ({ value: null, failure }),
                )
            : Promise.resolve({ value: null, failure: null }),
        ]);
        const thread = threadResult.value;
        if (threadResult.failure) {
          if (isAbort(threadResult.failure)) return;
          // Access lost (e.g. the message was reattributed): close it, keep the list fresh.
          setSelectedId(null);
          setHeader(null);
          setMessages([]);
          setError(errorMessage(threadResult.failure, "Falha ao abrir conversa."));
        }
        setConversations(list.items);
        setNextCursor(list.nextCursor);
        setTotal(list.total);
        if (thread) {
          setHeader(thread.conversation);
          setMessages((previous) =>
            mergeMessages(previous, [...thread.items].reverse()),
          );
          if (!pagedMessages.current) setOlderCursor(thread.nextCursor);
        }
        if (!threadResult.failure) setError(null);
      } catch (caught: unknown) {
        if (isAbort(caught)) return;
        setError(errorMessage(caught, "Falha ao consultar conversas."));
      } finally {
        if (!signal.aborted) setLoaded(true);
      }
    },
    [api, channel, search, cursors, selectedId],
  );
  useVisiblePolling(refresh);

  function select(id: string): void {
    if (id === selectedId) return;
    pagedMessages.current = false;
    setSelectedId(id);
    setHeader(null);
    setMessages([]);
    setOlderCursor(null);
  }

  /** A new channel or search starts again from the first page, with nothing open. */
  function restart(): void {
    setCursors([]);
    setConversations([]);
    setNextCursor(null);
    setTotal(0);
    setLoaded(false);
    setSelectedId(null);
    setMessages([]);
    setHeader(null);
  }

  async function loadOlder(): Promise<void> {
    if (!selectedId || !olderCursor) return;
    setLoadingOlder(true);
    try {
      const page = await api.listCompanyConversationMessages(selectedId, {
        limit: MESSAGE_PAGE_SIZE,
        cursor: olderCursor,
      });
      pagedMessages.current = true;
      setMessages((previous) =>
        mergeMessages(previous, [...page.items].reverse()),
      );
      setOlderCursor(page.nextCursor);
    } catch (caught: unknown) {
      setError(errorMessage(caught, "Falha ao carregar mensagens."));
    } finally {
      setLoadingOlder(false);
    }
  }

  const listPane = (
    <>
      {error && (
        <p role="alert" className="m-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </p>
      )}
      <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
        {conversations.map((item) => (
          <ConversationListItem
            key={item.id}
            active={item.id === selectedId}
            title={item.contact.name ?? address(item.channel, item.contact.address) ?? "Contato"}
            subtitle={item.contact.name ? address(item.channel, item.contact.address) : null}
            preview={item.lastMessage?.preview}
            time={item.lastMessageAt}
            channel={item.channel}
            chips={
              <span className="text-xs text-slate-400">
                · {item.messageCount} {item.messageCount === 1 ? "mensagem" : "mensagens"}
              </span>
            }
            onClick={() => select(item.id)}
          />
        ))}
        {loaded && conversations.length === 0 && !error && (
          <p className="p-6 text-center text-sm text-slate-500">
            {search
              ? "Nenhuma conversa encontrada para esta busca."
              : "Nenhuma conversa com mensagens da sua empresa."}
          </p>
        )}
      </div>
      {total > 0 && (
        <div className="border-t border-slate-200 p-3">
          <ListPagination
            page={cursors.length + 1}
            pageSize={LIST_PAGE_SIZE}
            total={total}
            hasNext={Boolean(nextCursor)}
            label={["conversa", "conversas"]}
            onPrevious={() => setCursors((current) => current.slice(0, -1))}
            onNext={() => {
              if (nextCursor) setCursors((current) => [...current, nextCursor]);
            }}
          />
        </div>
      )}
    </>
  );

  const contactName = header
    ? (header.contact.name ?? address(header.channel, header.contact.address) ?? "Contato")
    : "";
  const detailPane = selectedId ? (
    <section className="flex h-full min-h-0 flex-col" aria-label="Mensagens da conversa">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <BackToList onClick={() => setSelectedId(null)} />
        {header && <Avatar name={contactName} />}
        <div className="min-w-0 flex-1">
          {header && (
            <>
              <h2 className="truncate font-semibold text-slate-900">{contactName}</h2>
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                {header.contact.name && header.contact.address && (
                  <span className="wrap-anywhere">{address(header.channel, header.contact.address)}</span>
                )}
                <ChannelBadge channel={header.channel} />
              </p>
            </>
          )}
        </div>
      </header>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <ConversationMessages
          messages={messages}
          hasOlder={Boolean(olderCursor)}
          loadingOlder={loadingOlder}
          onLoadOlder={() => void loadOlder()}
        />
      </div>
      <p className="flex items-center gap-2 border-t border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-500">
        <Eye size={14} className="shrink-0" />
        Somente leitura. As respostas são feitas pelo atendimento CifraMais.
      </p>
    </section>
  ) : null;

  return (
    <section aria-label="Conversas da empresa">
      <InboxShell
        open={Boolean(selectedId)}
        toolbar={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchForm
              label="Buscar cliente"
              placeholder="Buscar por nome, telefone, CPF/CNPJ ou e-mail do cliente"
              onSearch={(term) => {
                setSearch(term);
                restart();
              }}
            />
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <span className="sr-only sm:not-sr-only">Canal</span>
              <select
                aria-label="Canal"
                className={`${fieldClass} w-full sm:w-40`}
                value={channel}
                onChange={(event) => {
                  setChannel(event.target.value as CommunicationChannel | "");
                  restart();
                }}
              >
                <option value="">Todos os canais</option>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="EMAIL">E-mail</option>
              </select>
            </label>
          </div>
        }
        list={listPane}
        detail={detailPane}
      />
    </section>
  );
}
