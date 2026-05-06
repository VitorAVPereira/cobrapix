"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  BellRing,
  CheckCheck,
  CheckCircle2,
  GraduationCap,
  Loader2,
  MailWarning,
} from "lucide-react";
import type {
  PaymentNotificationItem,
  PaymentNotificationStatus,
} from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";

const STATUS_LABELS: Record<PaymentNotificationStatus, string> = {
  PENDING: "Pendente",
  SENT: "Enviado",
  FAILED: "Falhou",
  READ: "Lido",
};

const STATUS_CLASSES: Record<PaymentNotificationStatus, string> = {
  PENDING: "border-amber-200 bg-amber-50 text-amber-700",
  SENT: "border-emerald-200 bg-emerald-50 text-emerald-700",
  FAILED: "border-rose-200 bg-rose-50 text-rose-700",
  READ: "border-slate-200 bg-slate-50 text-slate-500",
};

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function hasStudentData(notification: PaymentNotificationItem): boolean {
  return Boolean(
    notification.studentName ||
      notification.studentEnrollment ||
      notification.studentGroup,
  );
}

export default function PaymentNotificationsPage() {
  const apiClient = useApiClient();
  const [notifications, setNotifications] = useState<PaymentNotificationItem[]>(
    [],
  );
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadNotifications = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.getPaymentNotifications();
      setNotifications(response.data);
      setUnreadCount(response.unreadCount);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Nao foi possivel carregar as baixas.",
      );
    } finally {
      setLoading(false);
    }
  }, [apiClient]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  async function markAsRead(notificationId: string): Promise<void> {
    setMarkingId(notificationId);
    setError(null);

    try {
      const updated =
        await apiClient.markPaymentNotificationAsRead(notificationId);

      setNotifications((current) =>
        current.map((notification) =>
          notification.id === updated.id ? updated : notification,
        ),
      );
      setUnreadCount((current) => Math.max(current - 1, 0));
    } catch (markError) {
      setError(
        markError instanceof Error
          ? markError.message
          : "Nao foi possivel marcar como lida.",
      );
    } finally {
      setMarkingId(null);
    }
  }

  return (
    <main className="min-h-full bg-slate-50">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
              <BellRing size={14} />
              {unreadCount} alerta{unreadCount === 1 ? "" : "s"} aberto
            </div>
            <h1 className="text-2xl font-bold text-slate-900">
              Baixas de pagamento
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Historico operacional das faturas pagas e dos avisos enviados por
              e-mail.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadNotifications()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : null}
            Atualizar
          </button>
        </header>

        {error && (
          <div className="flex items-start gap-3 rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 shrink-0" size={18} />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="flex min-h-80 flex-col items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500">
            <Loader2 className="mb-3 animate-spin" size={34} />
            <p className="text-sm">Carregando baixas...</p>
          </div>
        ) : notifications.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-md bg-slate-100 text-slate-400">
              <CheckCircle2 size={28} />
            </div>
            <h2 className="font-semibold text-slate-900">
              Nenhuma baixa registrada
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
              Quando uma fatura for marcada como paga, o registro aparece aqui.
            </p>
          </div>
        ) : (
          <section className="grid gap-4">
            {notifications.map((notification) => {
              const studentData = hasStudentData(notification);

              return (
                <article
                  key={notification.id}
                  className="rounded-md border border-slate-200 bg-white p-5"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSES[notification.status]}`}
                        >
                          {STATUS_LABELS[notification.status]}
                        </span>
                        {notification.status === "FAILED" && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">
                            <MailWarning size={13} />
                            E-mail nao enviado
                          </span>
                        )}
                      </div>

                      <h2 className="mt-3 text-lg font-semibold text-slate-900">
                        {notification.debtorName}
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Fatura {notification.invoiceId}
                      </p>
                    </div>

                    <div className="text-left lg:text-right">
                      <p className="text-2xl font-bold text-emerald-700">
                        {formatBRL(notification.amount)}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {notification.billingType} -{" "}
                        {formatDateTime(notification.paidAt)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 text-sm text-slate-600 md:grid-cols-3">
                    <div>
                      <p className="text-xs font-semibold uppercase text-slate-400">
                        Destinatarios
                      </p>
                      <p className="mt-1 break-words">
                        {notification.recipientEmails.join(", ") || "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase text-slate-400">
                        Criado em
                      </p>
                      <p className="mt-1">
                        {formatDateTime(notification.createdAt)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase text-slate-400">
                        Enviado em
                      </p>
                      <p className="mt-1">{formatDateTime(notification.sentAt)}</p>
                    </div>
                  </div>

                  {studentData && (
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4 text-sm">
                      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">
                        <GraduationCap size={14} />
                        {notification.studentName ?? "Aluno"}
                      </span>
                      {notification.studentEnrollment && (
                        <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-600">
                          Matricula {notification.studentEnrollment}
                        </span>
                      )}
                      {notification.studentGroup && (
                        <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-600">
                          {notification.studentGroup}
                        </span>
                      )}
                    </div>
                  )}

                  {notification.errorMessage && (
                    <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {notification.errorMessage}
                    </div>
                  )}

                  {notification.status !== "READ" && (
                    <div className="mt-4 flex justify-end">
                      <button
                        type="button"
                        onClick={() => void markAsRead(notification.id)}
                        disabled={markingId === notification.id}
                        className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {markingId === notification.id ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <CheckCheck size={15} />
                        )}
                        Marcar como lida
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}
