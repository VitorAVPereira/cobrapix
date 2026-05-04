"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Clock,
  Loader2,
  MessageCircle,
  Search,
  Send,
} from "lucide-react";
import type {
  ConversationStatus,
  WhatsAppConversationItem,
  WhatsAppConversationMessage,
} from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";

const STATUS_LABELS: Record<string, string> = {
  NEW: "Nova",
  IN_PROGRESS: "Em andamento",
  CLOSED: "Fechada",
};

const STATUS_COLORS: Record<string, string> = {
  NEW: "bg-blue-100 text-blue-700",
  IN_PROGRESS: "bg-amber-100 text-amber-700",
  CLOSED: "bg-slate-100 text-slate-500",
};

function formatTime(isoDate: string): string {
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) return "";
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 60_000) return "agora";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}min`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(date);
}

function formatWindowTime(isoDate: string | null): string | null {
  if (!isoDate) return null;
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) return null;
  const now = Date.now();
  const remaining = date.getTime() - now;
  if (remaining <= 0) return "Expirada";
  const hours = Math.floor(remaining / 3600_000);
  const minutes = Math.floor((remaining % 3600_000) / 60_000);
  if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}min` : ""}`;
  return `${minutes}min`;
}

export default function InboxPage() {
  const apiClient = useApiClient();
  const [conversations, setConversations] = useState<
    WhatsAppConversationItem[]
  >([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<WhatsAppConversationMessage[]>([]);
  const [replyText, setReplyText] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  const loadConversations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.getConversations({
        search: search || undefined,
        status: statusFilter || undefined,
        pageSize: 50,
      });
      setConversations(result.data);
    } catch {
      setError("Nao foi possivel carregar as conversas.");
    } finally {
      setLoading(false);
    }
  }, [apiClient, search, statusFilter]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    async function load() {
      setLoadingMessages(true);
      try {
        const data = await apiClient.getConversationMessages(selectedId!);
        setMessages(data);
      } catch {
        setMessages([]);
      } finally {
        setLoadingMessages(false);
      }
    }
    void load();
  }, [apiClient, selectedId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendReply() {
    if (!replyText.trim() || !selectedId) return;
    setSending(true);
    try {
      await apiClient.replyToConversation(selectedId, replyText.trim());
      setReplyText("");
      const data = await apiClient.getConversationMessages(selectedId);
      setMessages(data);
      void loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar.");
    } finally {
      setSending(false);
    }
  }

  async function updateStatus(status: ConversationStatus) {
    if (!selectedId) return;
    try {
      await apiClient.updateConversationStatus(selectedId, status);
      void loadConversations();
    } catch {
      // silent
    }
  }

  const windowRemaining = formatWindowTime(selected?.serviceWindowExpiresAt ?? null);
  const windowExpired = windowRemaining === "Expirada";

  return (
    <div className="mx-auto flex h-[calc(100vh-5rem)] max-w-7xl flex-col p-4 sm:p-6 lg:p-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Inbox WhatsApp</h1>
          <p className="mt-1 text-sm text-slate-500">
            Responda mensagens de clientes dentro da janela de 24h.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          <AlertCircle className="mt-0.5 shrink-0" size={18} />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {/* Sidebar */}
        <div
          className={`flex w-full shrink-0 flex-col border-r border-slate-200 sm:w-80 ${
            selectedId ? "hidden sm:flex" : "flex"
          }`}
        >
          <div className="border-b border-slate-200 p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome ou telefone..."
                className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-emerald-500"
              />
            </div>
            <div className="mt-2 flex gap-2">
              {["", "NEW", "IN_PROGRESS", "CLOSED"].map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
                    statusFilter === status
                      ? "bg-slate-900 text-white"
                      : status
                        ? STATUS_COLORS[status]
                        : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {status ? STATUS_LABELS[status] : "Todas"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="animate-spin text-slate-400" size={22} />
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex h-32 items-center justify-center px-4 text-center text-sm text-slate-400">
                Nenhuma conversa encontrada.
              </div>
            ) : (
              conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => setSelectedId(conv.id)}
                  className={`w-full border-b border-slate-100 px-4 py-3 text-left transition hover:bg-slate-50 ${
                    selectedId === conv.id ? "bg-emerald-50" : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">
                        {conv.debtorName ?? conv.phoneNumber}
                      </span>
                      {conv.unreadCount > 0 && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1 text-xs font-bold text-white">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[conv.status]}`}>
                      {STATUS_LABELS[conv.status]}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {conv.lastMessagePreview ?? "Nova conversa"}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Chat area */}
        <div
          className={`flex flex-1 flex-col ${!selectedId ? "hidden sm:flex" : "flex"}`}
        >
          {!selected ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center text-slate-400">
              <MessageCircle size={48} className="mb-4 opacity-30" />
              <p className="text-lg font-medium">Selecione uma conversa</p>
              <p className="mt-1 text-sm">Escolha uma conversa na lista para visualizar.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSelectedId(null)}
                    className="rounded p-1 text-slate-400 hover:text-slate-600 sm:hidden"
                  >
                    <ArrowLeft size={18} />
                  </button>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {selected.debtorName ?? selected.phoneNumber}
                    </p>
                    <p className="text-xs text-slate-400">{selected.phoneNumber}</p>
                  </div>
                  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[selected.status]}`}>
                    {STATUS_LABELS[selected.status]}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {windowRemaining && (
                    <span
                      className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold ${
                        windowExpired
                          ? "bg-red-100 text-red-700"
                          : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      <Clock size={12} />
                      {windowRemaining}
                    </span>
                  )}
                  <select
                    value={selected.status}
                    onChange={(e) =>
                      void updateStatus(e.target.value as ConversationStatus)
                    }
                    className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600"
                  >
                    <option value="NEW">Nova</option>
                    <option value="IN_PROGRESS">Em andamento</option>
                    <option value="CLOSED">Fechar</option>
                  </select>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-3">
                {loadingMessages ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="animate-spin text-slate-400" size={22} />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-400">
                    Nenhuma mensagem ainda.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex ${msg.direction === "INBOUND" ? "justify-start" : "justify-end"}`}
                      >
                        <div
                          className={`max-w-[75%] rounded-lg px-4 py-2.5 text-sm ${
                            msg.direction === "INBOUND"
                              ? "bg-slate-100 text-slate-900"
                              : "bg-emerald-100 text-emerald-900"
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                          <p className="mt-1 text-right text-xs opacity-50">
                            {formatTime(msg.createdAt)}
                          </p>
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              <div className="border-t border-slate-200 px-4 py-3">
                {windowExpired ? (
                  <p className="text-center text-sm text-red-500">
                    Janela de 24h expirada. Nao e mais possivel responder.
                  </p>
                ) : (
                  <div className="flex items-end gap-2">
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (replyText.trim()) void sendReply();
                        }
                      }}
                      placeholder="Digite sua resposta..."
                      rows={1}
                      className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500"
                    />
                    <button
                      onClick={() => void sendReply()}
                      disabled={sending || !replyText.trim()}
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white transition hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {sending ? (
                        <Loader2 className="animate-spin" size={18} />
                      ) : (
                        <Send size={18} />
                      )}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
