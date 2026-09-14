"use client";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useSession } from "next-auth/react";
import { useApiClient } from "@/lib/use-api-client";

interface Message {
  id: string;
  content: string;
  direction?: string;
  companyId?: string | null;
  invoiceId: string | null;
  status: string | null;
  createdAt: string;
  conversation?: { channel: string };
}
interface Conversation {
  id: string;
  channel: string;
  recipient: string | null;
  status: string;
  unreadCount: number;
  lastMessagePreview: string | null;
  messages?: Message[];
  serviceWindowExpiresAt?: string | null;
}
export function CommunicationsHistory({
  admin = false,
}: {
  admin?: boolean;
}): ReactNode {
  const api = useApiClient();
  const { data: session, status } = useSession();
  const allowed =
    status === "authenticated" &&
    (!admin || session?.user.role === "PLATFORM_ADMIN");
  const [page, setPage] = useState(1);
  const [channel, setChannel] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [replyId, setReplyId] = useState<string | null>(null);
  const [replying, setReplying] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const load = useCallback(async (): Promise<void> => {
    if (!allowed) return;
    try {
      const path = `${admin ? "/communications/admin/conversations" : "/communications/outbound"}?page=${page}&pageSize=25${channel ? `&channel=${channel}` : ""}`;
      if (admin) {
        const response = await api.financialAdmin<{
          items: Conversation[];
          total: number;
        }>(path);
        setConversations(response.items);
        setTotal(response.total);
      } else {
        const response = await api.financialAdmin<{
          items: Message[];
          total: number;
        }>(path);
        setMessages(response.items);
        setTotal(response.total);
      }
      setError(null);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Falha ao consultar histórico.",
      );
    }
  }, [api, allowed, admin, page, channel]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  async function open(id: string): Promise<void> {
    try {
      setSelected(
        await api.financialAdmin<Conversation>(
          `/communications/admin/conversations/${id}`,
        ),
      );
      setReply("");
      setReplyId(null);
      setFeedback(null);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "Falha ao abrir conversa.",
      );
    }
  }
  async function sendReply(): Promise<void> {
    if (!selected || !reply.trim() || replying) return;
    const idempotencyId = replyId ?? crypto.randomUUID();
    setReplyId(idempotencyId);
    setReplying(true);
    setError(null);
    try {
      await api.financialAdmin(
        `/communications/admin/conversations/${selected.id}/replies`,
        "POST",
        { idempotencyId, content: reply.trim() },
      );
      setReply("");
      setReplyId(null);
      await open(selected.id);
      await load();
      setFeedback("Resposta enviada pelo atendimento central.");
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "Falha ao enviar resposta.",
      );
    } finally {
      setReplying(false);
    }
  }
  async function updateStatus(value: string): Promise<void> {
    if (!selected) return;
    try {
      await api.financialAdmin(
        `/communications/admin/conversations/${selected.id}/status`,
        "PATCH",
        { status: value },
      );
      await open(selected.id);
      await load();
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Falha ao atualizar atendimento.",
      );
    }
  }
  if (!allowed)
    return (
      <p className="p-8">
        {status === "loading" ? "Carregando…" : "Acesso restrito."}
      </p>
    );
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-5 sm:p-8">
      <h1 className="text-2xl font-semibold">
        {admin ? "Atendimento central" : "Meus envios"}
      </h1>
      <p className="text-sm text-slate-600">
        {admin
          ? "Conversas dos canais centrais, com contexto da empresa e cobrança."
          : "Histórico dos envios da sua empresa. As respostas são acompanhadas pelo atendimento CifraMais."}
      </p>
      <div className="flex gap-3">
        <label className="text-sm">
          Canal
          <select
            className="ml-2 rounded-lg border p-2"
            value={channel}
            onChange={(event) => {
              setChannel(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos</option>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="EMAIL">E-mail</option>
          </select>
        </label>
        <button className="rounded-lg border px-3" onClick={() => void load()}>
          Atualizar
        </button>
      </div>
      {error && (
        <p role="alert" className="bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      {admin ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            {conversations.map((item) => (
              <button
                key={item.id}
                onClick={() => void open(item.id)}
                className="w-full rounded-xl border bg-white p-4 text-left"
              >
                <div className="flex justify-between gap-2">
                  <strong>
                    {item.recipient ?? "Destinatário anonimizado"}
                  </strong>
                  <span className="text-xs">
                    {item.channel} · {item.unreadCount} novas
                  </span>
                </div>
                <p className="mt-2 truncate text-sm text-slate-600">
                  {item.lastMessagePreview}
                </p>
                <p className="mt-2 text-xs">{item.status}</p>
              </button>
            ))}
          </div>
          {selected && (
            <section className="space-y-4 rounded-xl border bg-white p-4">
              <h2 className="font-semibold">
                {selected.recipient ?? "Destinatário anonimizado"}
              </h2>
              <label className="text-sm">
                Atendimento
                <select
                  className="ml-2 rounded border p-2"
                  value={selected.status}
                  onChange={(event) => void updateStatus(event.target.value)}
                >
                  <option value="NEW">Novo</option>
                  <option value="IN_PROGRESS">Em atendimento</option>
                  <option value="CLOSED">Concluído</option>
                </select>
              </label>
              <ol className="space-y-3">
                {selected.messages?.map((item) => (
                  <li
                    key={item.id}
                    className={`rounded-lg p-3 text-sm ${item.direction === "INBOUND" ? "bg-slate-100" : "bg-emerald-50"}`}
                  >
                    <p className="whitespace-pre-wrap">{item.content}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      {new Date(item.createdAt).toLocaleString("pt-BR")} ·{" "}
                      {item.companyId
                        ? `Empresa ${item.companyId}`
                        : "Atendimento central"}
                    </p>
                  </li>
                ))}
              </ol>
              <div className="space-y-2 border-t pt-4">
                <label className="block text-sm font-medium">
                  Resposta do atendimento central
                  <textarea
                    aria-label="Resposta do atendimento central"
                    className="mt-2 min-h-28 w-full rounded-lg border p-3 font-normal"
                    maxLength={4000}
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                  />
                </label>
                {selected.channel === "WHATSAPP" &&
                  (!selected.serviceWindowExpiresAt ||
                    new Date(selected.serviceWindowExpiresAt) <=
                      new Date()) && (
                    <p className="text-sm text-amber-700">
                      A janela de atendimento do WhatsApp está fechada.
                    </p>
                  )}
                {feedback && (
                  <p role="status" className="text-sm text-emerald-700">
                    {feedback}
                  </p>
                )}
                <button
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  disabled={
                    replying ||
                    !reply.trim() ||
                    (selected.channel === "WHATSAPP" &&
                      (!selected.serviceWindowExpiresAt ||
                        new Date(selected.serviceWindowExpiresAt) <=
                          new Date()))
                  }
                  onClick={() => void sendReply()}
                >
                  {replying ? "Enviando…" : "Enviar resposta"}
                </button>
              </div>
            </section>
          )}
        </div>
      ) : (
        <ol className="space-y-3">
          {messages.map((item) => (
            <li key={item.id} className="rounded-xl border bg-white p-4">
              <p className="whitespace-pre-wrap text-sm">{item.content}</p>
              <p className="mt-2 text-xs text-slate-500">
                {new Date(item.createdAt).toLocaleString("pt-BR")} ·{" "}
                {item.conversation?.channel} · {item.status ?? "Enviado"}
                {item.invoiceId ? ` · Cobrança ${item.invoiceId}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
      {total === 0 && (
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
          disabled={page * 25 >= total}
          className="disabled:opacity-40"
          onClick={() => setPage((value) => value + 1)}
        >
          Próxima
        </button>
      </div>
    </div>
  );
}
