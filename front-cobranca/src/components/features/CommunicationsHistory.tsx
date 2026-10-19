"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useSession } from "next-auth/react";
import { useApiClient } from "@/lib/use-api-client";
import { useVisiblePolling } from "@/lib/use-visible-polling";
import type {
  AdminClient,
  AdminConversationDetail,
  AdminConversationMessage,
  AdminConversationSummary,
  CommunicationChannel,
  ConversationStatus,
} from "@/lib/api-client";
import { ListPagination } from "@/components/ui/ListPagination";
import { TablePagination } from "@/components/ui/TablePagination";
import { formatWhatsAppNumber } from "@/lib/whatsapp-number";
import { Clock, Mail, MessageCircle, RefreshCw } from "lucide-react";
import {
  Avatar,
  BackToList,
  ChannelBadge,
  ConversationListItem,
  InboxShell,
  STATUS_LABELS,
  StatusChip,
  fieldClass,
  messageTime,
  useStickToBottom,
} from "./communications/InboxParts";
import { SearchForm } from "@/components/ui/SearchForm";
import { TemplatePendingSends } from "./templates/TemplatePendingSends";
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

const PAGE_SIZE = 20;
const INBOX_PAGE_SIZE = 10;

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
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
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
        `/communications/outbound?page=${page}&pageSize=${pageSize}${channel ? `&channel=${channel}` : ""}`,
      );
      setMessages(response.items);
      setTotal(response.total);
      setError(null);
    } catch (caught: unknown) {
      setError(errorMessage(caught, "Falha ao consultar histórico."));
    }
  }, [api, page, pageSize, channel]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  return (
    <section className="overflow-hidden rounded-md border border-slate-200 bg-white" aria-label="Envios da empresa">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Canal
          <select
            className={`${fieldClass} w-44`}
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
      </div>
      {error && (
        <p role="alert" className="m-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </p>
      )}
      <ol className="divide-y divide-slate-100">
        {messages.map((item) => {
          const whatsapp = item.conversation?.channel === "WHATSAPP";
          const Icon = whatsapp ? MessageCircle : Mail;
          return (
            <li key={item.id} className="flex gap-3 px-4 py-3">
              <Icon size={16} className={`mt-0.5 shrink-0 ${whatsapp ? "text-emerald-600" : "text-sky-600"}`} />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-3 whitespace-pre-wrap text-sm text-slate-800 wrap-anywhere">{item.content}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {formatDateTime(item.createdAt)} · {whatsapp ? "WhatsApp" : "E-mail"} · {statusLabel(item.status)}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {total === 0 && !error && (
        <p className="p-6 text-center text-sm text-slate-500">Nenhum envio encontrado.</p>
      )}
      {total > 0 && (
        <TablePagination
          page={page}
          pageSize={pageSize}
          total={total}
          pageSizeLabel="Envios por página"
          onChange={(next) => {
            setPage(next.page);
            setPageSize(next.pageSize);
          }}
        />
      )}
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
    companyId: string;
    search: string;
  }>({
    channel: "",
    status: "",
    pendingClassification: false,
    companyId: "",
    search: "",
  });
  const [companies, setCompanies] = useState<AdminClient[]>([]);
  const [companiesError, setCompaniesError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<
    AdminConversationSummary[]
  >([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminConversationDetail | null>(
    null,
  );
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [classifying, setClassifying] =
    useState<AdminConversationMessage | null>(null);
  const [quoting, setQuoting] = useState<AdminConversationMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pagedMessages = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  useStickToBottom(scroller, selected?.id ?? null, selected?.messages.at(-1)?.id ?? null);

  const refresh = useCallback(
    async (signal: AbortSignal): Promise<void> => {
      try {
        const [list, detail] = await Promise.all([
          api.listAdminConversations(
            {
              page,
              pageSize: INBOX_PAGE_SIZE,
              channel: filters.channel || undefined,
              status: filters.status || undefined,
              pendingClassification: filters.pendingClassification || undefined,
              companyId: filters.companyId || undefined,
              search: filters.search || undefined,
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

  useEffect(() => {
    let active = true;
    api
      .getAdminClients()
      .then((list) => {
        if (active)
          setCompanies(
            [...list].sort((a, b) =>
              a.corporateName.localeCompare(b.corporateName, "pt-BR"),
            ),
          );
      })
      .catch((caught: unknown) => {
        // The inbox keeps working; only the company filter is unavailable.
        if (active)
          setCompaniesError(
            errorMessage(caught, "Falha ao carregar a lista de empresas."),
          );
      });
    return () => {
      active = false;
    };
  }, [api]);

  const reload = useCallback(async (): Promise<void> => {
    await refresh(new AbortController().signal);
  }, [refresh]);

  /** Every filter change starts again from the first page. */
  function filter(change: Partial<typeof filters>): void {
    setFilters((current) => ({ ...current, ...change }));
    setPage(1);
  }
  const filtered = Boolean(
    filters.channel ||
      filters.status ||
      filters.pendingClassification ||
      filters.companyId ||
      filters.search,
  );

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

  const recipientName = (item: { channel: CommunicationChannel; recipient: string | null }) =>
    item.recipient
      ? item.channel === "WHATSAPP"
        ? formatWhatsAppNumber(item.recipient)
        : item.recipient
      : "Destinatário anonimizado";

  const toolbar = (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <SearchForm
          label="Buscar cliente ou telefone"
          placeholder="Buscar por cliente, telefone, CPF/CNPJ ou e-mail"
          onSearch={(search) => filter({ search })}
        />
        <div className="flex gap-2">
          <label className="min-w-0 flex-1 lg:w-56 lg:flex-none">
            <span className="sr-only">Empresa</span>
            <select
              aria-label="Empresa"
              className={`${fieldClass} w-full`}
              value={filters.companyId}
              onChange={(event) => filter({ companyId: event.target.value })}
            >
              <option value="">Todas as empresas</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.corporateName}
                </option>
              ))}
            </select>
          </label>
          <label className="w-36 shrink-0">
            <span className="sr-only">Canal</span>
            <select
              aria-label="Canal"
              className={`${fieldClass} w-full`}
              value={filters.channel}
              onChange={(event) => filter({ channel: event.target.value as CommunicationChannel | "" })}
            >
              <option value="">Todos os canais</option>
              <option value="WHATSAPP">WhatsApp</option>
              <option value="EMAIL">E-mail</option>
            </select>
          </label>
          <button
            type="button"
            aria-label="Atualizar"
            title="Atualizar"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100"
            onClick={() => void reload()}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            ["", "Todas"],
            ["NEW", "Novas"],
            ["IN_PROGRESS", "Em atendimento"],
            ["CLOSED", "Concluídas"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value || "all"}
            type="button"
            aria-pressed={filters.status === value}
            onClick={() => filter({ status: value })}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              filters.status === value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-slate-200" aria-hidden />
        <label
          className={`flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
            filters.pendingClassification ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          <input
            type="checkbox"
            className="sr-only"
            checked={filters.pendingClassification}
            onChange={(event) => filter({ pendingClassification: event.target.checked })}
          />
          Somente com mensagens sem classificação
        </label>
      </div>
    </div>
  );

  const list = (
    <>
      {error && (
        <p role="alert" className="m-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </p>
      )}
      {companiesError && (
        <p role="alert" className="m-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {companiesError}
        </p>
      )}
      <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
        {conversations.map((item) => (
          <ConversationListItem
            key={item.id}
            active={item.id === selectedId}
            title={recipientName(item)}
            preview={item.lastMessagePreview}
            time={item.lastInboundAt ?? item.updatedAt}
            channel={item.channel}
            unread={item.unreadCount}
            chips={
              <>
                <StatusChip status={item.status} />
                {item.unclassifiedCount > 0 && (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                    {item.unclassifiedCount} sem classificação
                  </span>
                )}
              </>
            }
            onClick={() => select(item.id)}
          />
        ))}
        {total === 0 && !error && (
          <p className="p-6 text-center text-sm text-slate-500">
            {filtered ? "Nenhuma conversa encontrada para estes filtros." : "Nenhuma comunicação encontrada."}
          </p>
        )}
      </div>
      {(total > 0 || page > 1) && (
        <div className="border-t border-slate-200 p-3">
          <ListPagination
            page={page}
            pageSize={INBOX_PAGE_SIZE}
            total={total}
            hasNext={page * INBOX_PAGE_SIZE < total}
            label={["conversa", "conversas"]}
            onPrevious={() => setPage((value) => value - 1)}
            onNext={() => setPage((value) => value + 1)}
          />
        </div>
      )}
    </>
  );

  const windowOpen = selected ? serviceWindowOpen(selected.serviceWindowExpiresAt) : false;
  const detail = selected ? (
    <section className="flex h-full min-h-0 flex-col" aria-label="Conversa selecionada">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-4 py-3">
        <BackToList onClick={() => setSelectedId(null)} />
        <Avatar name={recipientName(selected)} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold text-slate-900">{recipientName(selected)}</h2>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <ChannelBadge channel={selected.channel} />
            {selected.channel === "WHATSAPP" && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
                  windowOpen ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                }`}
                title={
                  windowOpen
                    ? `Janela de atendimento aberta até ${formatDateTime(selected.serviceWindowExpiresAt!)}`
                    : "Janela de atendimento fechada: somente templates aprovados e liberados para a empresa."
                }
              >
                <Clock size={12} />
                {windowOpen
                  ? `Janela aberta até ${messageTime(selected.serviceWindowExpiresAt!)}`
                  : "Janela fechada: só templates"}
              </span>
            )}
          </p>
        </div>
        <div role="group" aria-label="Atendimento" className="flex shrink-0 rounded-md border border-slate-200 bg-slate-50 p-0.5">
          {(Object.keys(STATUS_LABELS) as ConversationStatus[]).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={selected.status === value}
              onClick={() => {
                if (selected.status !== value) void updateStatus(value);
              }}
              className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                selected.status === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {STATUS_LABELS[value]}
            </button>
          ))}
        </div>
      </header>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
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
      </div>
      <div className="max-h-[45%] shrink-0 overflow-y-auto border-t border-slate-200 bg-white px-4 py-3">
        <AdminConversationContext
          key={selected.id}
          conversation={selected}
          classifying={classifying}
          quoting={quoting}
          onCancelClassify={() => setClassifying(null)}
          onCancelQuote={() => setQuoting(null)}
          onChanged={reload}
        />
      </div>
    </section>
  ) : null;

  return <InboxShell toolbar={toolbar} list={list} detail={detail} open={Boolean(selectedId)} />;
}

export function CommunicationsHistory({
  admin = false,
}: {
  admin?: boolean;
}): ReactNode {
  const { data: session, status } = useSession();
  const [tab, setTab] = useState<"conversations" | "outbound" | "pending">(
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
    <div className="mx-auto max-w-7xl space-y-4 p-4 lg:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {admin ? "Atendimento central" : "Conversas e envios"}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {admin
            ? "Todas as conversas dos canais centrais, com empresa e cobrança por mensagem."
            : "Mensagens da sua empresa no canal central. As respostas são acompanhadas pelo atendimento CifraMais."}
        </p>
      </div>
      {admin ? (
        <AdminInbox key={viewerKey} />
      ) : (
        <>
          <div role="tablist" className="flex gap-2 border-b border-slate-200">
            {(
              [
                ["conversations", "Conversas"],
                ["outbound", "Envios"],
                ["pending", "Pendências"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={tab === value}
                className={`-mb-px px-3 py-2 text-sm ${tab === value ? "border-b-2 border-emerald-600 font-semibold text-emerald-700" : "text-slate-600 hover:text-slate-900"}`}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "conversations" ? (
            <CompanyConversations key={viewerKey} />
          ) : tab === "outbound" ? (
            <OutboundHistory key={viewerKey} />
          ) : (
            <TemplatePendingSends key={viewerKey} scope="COMPANY" />
          )}
        </>
      )}
    </div>
  );
}
