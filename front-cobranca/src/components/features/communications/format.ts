import type { ApiError } from "@/lib/api-client";

const STATUS_LABELS: Record<string, string> = {
  pending: "Na fila",
  sending: "Enviando",
  accepted: "Aceita pelo provedor",
  sent: "Enviada",
  delivered: "Entregue",
  read: "Lida",
  failed: "Falhou",
  delivery_uncertain: "Resultado incerto",
  received: "Recebida",
};

/** Admin-facing explanation of a queued send that was not transmitted. */
const REASON_LABELS: Record<string, string> = {
  SERVICE_WINDOW_CLOSED:
    "A janela de 24 horas fechou antes do envio. Use um template aprovado.",
  TEMPLATE_UNAVAILABLE:
    "O template deixou de estar aprovado ou está em revisão.",
  TEMPLATE_PARAMETERS_INVALID:
    "Os parâmetros não correspondem ao template aprovado.",
  RECIPIENT_SUPPRESSED:
    "O contato pediu cancelamento; envios pausados até revisão.",
  COLLECTION_NO_LONGER_ELIGIBLE:
    "A cobrança não está mais pendente ou o devedor não autoriza WhatsApp.",
  COMPANY_TEMPLATE_DISABLED: "A empresa desativou este template.",
  TRANSPORT_CHANGED_REVIEW_REQUIRED:
    "O canal mudou depois do agendamento; revise antes de enviar.",
  DELIVERY_UNCERTAIN:
    "Resultado incerto: o provedor pode ter recebido. Não reenvie sem conferir.",
  WORKER_LOST_AFTER_CLAIM:
    "Resultado incerto: o envio foi interrompido. Não reenvie sem conferir.",
  WAITING_FOR_CHANNEL: "Aguardando limite ou disponibilidade do canal.",
};

export function statusLabel(status: string | null): string {
  return status ? (STATUS_LABELS[status] ?? status) : "Registrada";
}

export function reasonLabel(code: string | null | undefined): string | null {
  return code ? (REASON_LABELS[code] ?? "Envio recusado antes da transmissão.") : null;
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR");
}

export function formatInvoice(invoice: {
  dueDate: string;
  originalAmount: string | number;
}): string {
  const amount = Number(invoice.originalAmount).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
  return `Cobrança de ${amount} · vencimento ${new Date(invoice.dueDate).toLocaleDateString("pt-BR", { timeZone: "UTC" })}`;
}

/** 403/404 are shown without revealing whether the conversation exists. */
export function errorMessage(caught: unknown, fallback: string): string {
  const status = (caught as ApiError | undefined)?.status;
  if (status === 403) return "Você não tem acesso a esta informação.";
  if (status === 404) return "Conversa não encontrada.";
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

export function isAbort(caught: unknown): boolean {
  return caught instanceof DOMException && caught.name === "AbortError";
}

export function serviceWindowOpen(expiresAt: string | null): boolean {
  return Boolean(expiresAt && new Date(expiresAt) > new Date());
}
