"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useSession } from "next-auth/react";
import { useApiClient } from "@/lib/use-api-client";
import { useVisiblePolling } from "@/lib/use-visible-polling";
import type {
  AdminConversationDetail,
  AdminConversationMessage,
  AdminConversationSummary,
  CommunicationChannel,
  ConversationStatus,
  MessageTemplate,
} from "@/lib/api-client";
import { CompanyConversations } from "./communications/CompanyConversations";
import { ConversationMessages } from "./communications/ConversationMessages";
import {
  AdminConversationContext,
  AdminMessageDetails,
} from "./communications/AdminConversationContext";
import {
  errorMessage,
  formatDateTime,
  isAbort,
  serviceWindowOpen,
  statusLabel,
} from "./communications/format";

const PAGE_SIZE = 25;

interface OutboundMessage {
  id: string;
  content: string;
  invoiceId: string | null;
  status: string | null;
  createdAt: string;
  conversation?: { channel: string };
}

/** Company send history (WhatsApp and e-mail), kept alongside the conversation view. */
function OutboundHistory(): ReactNode {
  const api = useApiClient();
  const [page, setPage] = useState(1);
  const [channel, setChannel] = useState<CommunicationChannel | "">("");
  const [messages, setMessages] = useState<OutboundMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await api.financialAdmin<{
        items: OutboundMessage[];
        total: number;
      }>(
        `/communications/outbound?page=${page}&pageSize=${PAGE_SIZE}${channel ? `&channel=${channel}` : ""}`,
      );
      setMessages(response.items);
      setTotal(response.total);
      setError(null);
    } catch (caught: unknown) {
      setError(errorMessage(caught, "Falha ao consultar histórico."));
    }
  }, [api, page, channel]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  return (
    <section className="space-y-4" aria-label="Envios da empresa">
      <label className="text-sm">
        Canal
        <select
          className="ml-2 rounded-lg border p-2"
          value={channel}
          onChange={(event) => {
            setChannel(event.target.value as CommunicationChannel | "");
            setPage(1);
          }}
        >
          <option value="">Todos</option>
          <option value="WHATSAPP">WhatsApp</option>
          <option value="EMAIL">E-mail</option>
        </select>
      </label>
      {error && (
        <p role="alert" className="bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      <ol className="space-y-3">
        {messages.map((item) => (
          <li key={item.id} className="rounded-xl border bg-white p-4">
            <p className="whitespace-pre-wrap text-sm">{item.content}</p>
            <p className="mt-2 text-xs text-slate-500">
              {formatDateTime(item.createdAt)} · {item.conversation?.channel} ·{" "}
              {statusLabel(item.status)}
            </p>
          </li>
        ))}
      </ol>
      {total === 0 && !error && (
        <p className="rounded-xl border bg-white p-6 text-slate-500">
          Nenhum envio encontrado.
        </p>
      )}
      <div className="flex gap-4 text-sm">
        <button
          disabled={page === 1}
          className="disabled:opacity-40"
          onClick={() => setPage((value) => value - 1)}
        >
          Anterior
        </button>
        <span>Página {page}</span>
        <button
          disabled={page * PAGE_SIZE >= total}
          className="disabled:opacity-40"
          onClick={() => setPage((value) => value + 1)}
        >
          Próxima
        </button>
      </div>
    </section>
  );
}

function mergeAdminMessages(
  loaded: AdminConversationMessage[],
  page: AdminConversationMessage[],
): AdminConversationMessage[] {
  const byId = new Map(loaded.map((message) => [message.id, message]));
  for (const message of page) byId.set(message.id, message);
  return [...byId.values()].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

/** Global view for the platform team: every conversation, classification and replies. */
function AdminInbox(): ReactNode {
  const api = useApiClient();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<{
    channel: CommunicationChannel | "";
    status: ConversationStatus | "";
    pendingClassification: boolean;
  }>({ channel: "", status: "", pendingClassification: false });
  const [conversations, setConversations] = useState<
    AdminConversationSummary[]
  >([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminConversationDetail | null>(
    null,
  );
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [classifying, setClassifying] =
    useState<AdminConversationMessage | null>(null);
  const [quoting, setQuoting] = useState<AdminConversationMessage | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const pagedMessages = useRef(false);

  useEffect(() => {
    api
      .getTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, [api]);

  const refresh = useCallback(
    async (signal: AbortSignal): Promise<void> => {
      try {
        const [list, detail] = await Promise.all([
          api.listAdminConversations(
            {
              page,
              pageSize: PAGE_SIZE,
              channel: filters.channel || undefined,
              status: filters.status || undefined,
              pendingClassification: filters.pendingClassification || undefined,
            },
            signal,
          ),
          selectedId
            ? api.getAdminConversation(selectedId, {}, signal)
            : Promise.resolve(null),
        ]);
        setConversations(list.items);
        setTotal(list.total);
        if (detail) {
          setSelected((current) =>
            current?.id === detail.id
              ? {
                  ...detail,
                  messages: mergeAdminMessages(
                    current.messages,
                    detail.messages,
                  ),
                }
              : detail,
          );
          if (!pagedMessages.current) setOlderCursor(detail.nextCursor);
        }
        setError(null);
      } catch (caught: unknown) {
        if (!isAbort(caught))
          setError(errorMessage(caught, "Falha ao consultar conversas."));
      }
    },
    [api, page, filters, selectedId],
  );
  useVisiblePolling(refresh);

  const reload = useCallback(async (): Promise<void> => {
    await refresh(new AbortController().signal);
  }, [refresh]);

  function select(id: string): void {
    pagedMessages.current = false;
    setSelectedId(id);
    setSelected(null);
    setOlderCursor(null);
    setClassifying(null);
    setQuoting(null);
  }

  async function loadOlder(): Promise<void> {
    if (!selected || !olderCursor) return;
    try {
      const older = await api.getAdminConversation(selected.id, {
        cursor: olderCursor,
      });
      pagedMessages.current = true;
      setSelected((current) =>
        current
          ? {
              ...current,
              messages: mergeAdminMessages(current.messages, older.messages),
            }
          : current,
      );
      setOlderCursor(older.nextCursor);
    } catch (caught: unknown) {
      setError(errorMessage(caught, "Falha ao carregar mensagens."));
    }
  }

  async function updateStatus(status: ConversationStatus): Promise<void> {
    if (!selected) return;
    try {
      await api.updateAdminConversationStatus(selected.id, status);
      await reload();
    } catch (caught: unknown) {
      setError(errorMessage(caught, "Falha ao atualizar atendimento."));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Canal
          <select
            className="ml-2 rounded-lg border p-2"
            value={filters.channel}
            onChange={(event) => {
              setFilters((current) => ({
                ...current,
                channel: event.target.value as CommunicationChannel | "",
              }));
              setPage(1);
            }}
          >
            <option value="">Todos</option>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="EMAIL">E-mail</option>
          </select>
        </label>
        <label className="text-sm">
          Atendimento
          <select
            className="ml-2 rounded-lg border p-2"
            value={filters.status}
            onChange={(event) => {
              setFilters((current) => ({
                ...current,
                status: event.target.value as ConversationStatus | "",
              }));
              setPage(1);
            }}
          >
            <option value="">Todos</option>
            <option value="NEW">Novo</option>
            <option value="IN_PROGRESS">Em atendimento</option>
            <option value="CLOSED">Concluído</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={filters.pendingClassification}
            onChange={(event) => {
              setFilters((current) => ({
                ...current,
                pendingClassification: event.target.checked,
              }));
              setPage(1);
            }}
          />
          Somente com mensagens sem classificação
        </label>
        <button
          className="rounded-lg border px-3 py-2 text-sm"
          onClick={() => void reload()}
        >
          Atualizar
        </button>
      </div>
      {error && (
        <p role="alert" className="bg-red-50 p-3 text-red-800">
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
                <strong>{item.recipient ?? "Destinatário anonimizado"}</strong>
                <span className="text-xs">
                  {item.channel} · {item.unreadCount} novas
                </span>
              </div>
              <p className="mt-2 truncate text-sm text-slate-600">
                {item.lastMessagePreview}
              </p>
              <p className="mt-2 text-xs">
                {item.status}
                {item.unclassifiedCount > 0 &&
                  ` · ${item.unclassifiedCount} sem classificação`}
              </p>
            </button>
          ))}
          {total === 0 && !error && (
            <p className="rounded-xl border bg-white p-6 text-slate-500">
              Nenhuma comunicação encontrada.
            </p>
          )}
          <div className="flex gap-4 text-sm">
            <button
              disabled={page === 1}
              className="disabled:opacity-40"
              onClick={() => setPage((value) => value - 1)}
            >
              Anterior
            </button>
            <span>Página {page}</span>
            <button
              disabled={page * PAGE_SIZE >= total}
              className="disabled:opacity-40"
              onClick={() => setPage((value) => value + 1)}
            >
              Próxima
            </button>
          </div>
        </div>
        {selected && (
          <section
            className="space-y-4 rounded-xl border bg-white p-4"
            aria-label="Conversa selecionada"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">
                {selected.recipient ?? "Destinatário anonimizado"}
              </h2>
              <label className="text-sm">
                Atendimento
                <select
                  className="ml-2 rounded border p-2"
                  value={selected.status}
                  onChange={(event) =>
                    void updateStatus(event.target.value as ConversationStatus)
                  }
                >
                  <option value="NEW">Novo</option>
                  <option value="IN_PROGRESS">Em atendimento</option>
                  <option value="CLOSED">Concluído</option>
                </select>
              </label>
            </div>
            {selected.channel === "WHATSAPP" && (
              <p className="text-xs text-slate-600">
                {serviceWindowOpen(selected.serviceWindowExpiresAt)
                  ? `Janela de atendimento aberta até ${formatDateTime(selected.serviceWindowExpiresAt!)}`
                  : "Janela de atendimento fechada: somente templates aprovados."}
              </p>
            )}
            <ConversationMessages
              messages={selected.messages}
              hasOlder={Boolean(olderCursor)}
              onLoadOlder={() => void loadOlder()}
              renderDetails={(message) => (
                <AdminMessageDetails
                  message={message}
                  canQuote={selected.channel === "WHATSAPP"}
                  onClassify={setClassifying}
                  onQuote={setQuoting}
                />
              )}
            />
            <AdminConversationContext
              key={selected.id}
              conversation={selected}
              templates={templates}
              classifying={classifying}
              quoting={quoting}
              onCancelClassify={() => setClassifying(null)}
              onCancelQuote={() => setQuoting(null)}
              onChanged={reload}
            />
          </section>
        )}
      </div>
    </div>
  );
}

export function CommunicationsHistory({
  admin = false,
}: {
  admin?: boolean;
}): ReactNode {
  const { data: session, status } = useSession();
  const [tab, setTab] = useState<"conversations" | "outbound">(
    "conversations",
  );
  const allowed =
    status === "authenticated" &&
    (!admin || session?.user.role === "PLATFORM_ADMIN");
  if (!allowed)
    return (
      <p className="p-8">
        {status === "loading" ? "Carregando…" : "Acesso restrito."}
      </p>
    );
  // A new user or company remounts the views, dropping every cached conversation.
  const viewerKey = `${session?.user.id ?? ""}:${session?.user.companyId ?? ""}`;
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-5 sm:p-8">
      <h1 className="text-2xl font-semibold">
        {admin ? "Atendimento central" : "Conversas e envios"}
      </h1>
      <p className="text-sm text-slate-600">
        {admin
          ? "Todas as conversas dos canais centrais, com empresa e cobrança por mensagem."
          : "Mensagens da sua empresa no canal central. As respostas são acompanhadas pelo atendimento CifraMais."}
      </p>
      {admin ? (
        <AdminInbox key={viewerKey} />
      ) : (
        <>
          <div role="tablist" className="flex gap-2 border-b">
            {(
              [
                ["conversations", "Conversas"],
                ["outbound", "Envios"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={tab === value}
                className={`px-3 py-2 text-sm ${tab === value ? "border-b-2 border-indigo-600 font-semibold" : "text-slate-600"}`}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "conversations" ? (
            <CompanyConversations key={viewerKey} />
          ) : (
            <OutboundHistory key={viewerKey} />
          )}
        </>
      )}
    </div>
  );
}
