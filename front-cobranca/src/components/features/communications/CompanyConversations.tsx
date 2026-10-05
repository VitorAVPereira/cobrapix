"use client";
import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  CommunicationChannel,
  CompanyConversation,
  CompanyConversationMessages,
  ConversationMessage,
} from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";
import { useVisiblePolling } from "@/lib/use-visible-polling";
import { ListPagination } from "@/components/ui/ListPagination";
import { SearchForm } from "@/components/ui/SearchForm";
import { ConversationMessages } from "./ConversationMessages";
import { errorMessage, formatDateTime, isAbort } from "./format";

const LIST_PAGE_SIZE = 10;
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

  return (
    <section className="space-y-4" aria-label="Conversas da empresa">
      <p className="text-sm text-slate-600">
        Somente leitura. As respostas são feitas pelo atendimento CifraMais.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <SearchForm
          label="Buscar cliente"
          placeholder="Buscar por nome, telefone, CPF/CNPJ ou e-mail do cliente"
          onSearch={(term) => {
            setSearch(term);
            restart();
          }}
        />
        <label className="text-sm">
          Canal
          <select
            className="ml-2 rounded-lg border p-2"
            value={channel}
            onChange={(event) => {
              setChannel(event.target.value as CommunicationChannel | "");
              restart();
            }}
          >
            <option value="">Todos</option>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="EMAIL">E-mail</option>
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-2">
          {conversations.map((item) => (
            <button
              key={item.id}
              aria-pressed={item.id === selectedId}
              onClick={() => select(item.id)}
              className={`w-full rounded-xl border p-4 text-left ${item.id === selectedId ? "border-indigo-500 bg-indigo-50" : "bg-white"}`}
            >
              <div className="flex justify-between gap-2">
                <strong className="truncate">
                  {item.contact.name ?? item.contact.address ?? "Contato"}
                </strong>
                <span className="shrink-0 text-xs text-slate-500">
                  {item.channel === "WHATSAPP" ? "WhatsApp" : "E-mail"}
                </span>
              </div>
              {item.contact.name && item.contact.address && (
                <p className="text-xs text-slate-500 wrap-anywhere">
                  {item.contact.address}
                </p>
              )}
              <p className="mt-2 truncate text-sm text-slate-600">
                {item.lastMessage?.preview}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {formatDateTime(item.lastMessageAt)} · {item.messageCount}{" "}
                {item.messageCount === 1 ? "mensagem" : "mensagens"}
              </p>
            </button>
          ))}
          {loaded && conversations.length === 0 && !error && (
            <p className="rounded-xl border bg-white p-6 text-slate-500">
              {search
                ? "Nenhuma conversa encontrada para esta busca."
                : "Nenhuma conversa com mensagens da sua empresa."}
            </p>
          )}
          {total > 0 && (
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
          )}
        </div>
        {selectedId && (
          <section
            className="space-y-4 rounded-xl border bg-white p-4"
            aria-label="Mensagens da conversa"
          >
            {header && (
              <h2 className="font-semibold wrap-anywhere">
                {header.contact.name ?? header.contact.address ?? "Contato"}
              </h2>
            )}
            <ConversationMessages
              messages={messages}
              hasOlder={Boolean(olderCursor)}
              loadingOlder={loadingOlder}
              onLoadOlder={() => void loadOlder()}
            />
          </section>
        )}
      </div>
    </section>
  );
}
