"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  History,
  Loader2,
  ReceiptText,
  TrendingUp,
  X,
  type LucideIcon,
} from "lucide-react";
import type {
  DebtorPaymentHistoryItem,
  DebtorPaymentHistoryResponse,
  PaymentTimeliness,
} from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";

interface DebtorPaymentHistoryModalProps {
  debtorId: string;
  debtorName: string;
  onClose: () => void;
}

const TIMELINESS_META: Record<
  PaymentTimeliness,
  {
    label: string;
    className: string;
    Icon: LucideIcon;
  }
> = {
  EARLY: {
    label: "Pago antes",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    Icon: CheckCircle2,
  },
  ON_DUE_DATE: {
    label: "No vencimento",
    className: "border-sky-200 bg-sky-50 text-sky-700",
    Icon: CalendarDays,
  },
  OVERDUE: {
    label: "Em atraso",
    className: "border-rose-200 bg-rose-50 text-rose-700",
    Icon: Clock3,
  },
  UNKNOWN: {
    label: "Sem data",
    className: "border-slate-200 bg-slate-50 text-slate-500",
    Icon: AlertCircle,
  },
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }

  const [year, month, day] = value.split("-");
  if (!year || !month || !day) {
    return value;
  }

  return `${day}/${month}/${year}`;
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

function getPaymentMethodLabel(method: string): string {
  if (method === "BOLETO") {
    return "Boleto";
  }

  if (method === "BOLIX") {
    return "Bolix";
  }

  return "PIX";
}

function getTimingDetail(payment: DebtorPaymentHistoryItem): string {
  if (payment.timeliness === "OVERDUE") {
    const days = payment.daysAfterDue ?? 0;
    return `${days} dia${days === 1 ? "" : "s"} após vencer`;
  }

  if (payment.timeliness === "EARLY") {
    const days = payment.daysBeforeDue ?? 0;
    return `${days} dia${days === 1 ? "" : "s"} antes`;
  }

  if (payment.timeliness === "ON_DUE_DATE") {
    return "Pago no dia";
  }

  return "Data ausente";
}

function hasStudentData(payment: DebtorPaymentHistoryItem): boolean {
  return Boolean(
    payment.studentName || payment.studentEnrollment || payment.studentGroup,
  );
}

export function DebtorPaymentHistoryModal({
  debtorId,
  debtorName,
  onClose,
}: DebtorPaymentHistoryModalProps) {
  const apiClient = useApiClient();
  const [history, setHistory] = useState<DebtorPaymentHistoryResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadHistory(): Promise<void> {
      setLoading(true);
      setError(null);

      try {
        const response = await apiClient.getDebtorPaymentHistory(debtorId);

        if (active) {
          setHistory(response);
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Nao foi possivel carregar o historico de pagamentos.",
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadHistory();

    return () => {
      active = false;
    };
  }, [apiClient, debtorId]);

  const payments = history?.payments ?? [];
  const summary = history?.summary;
  const punctualityRate = useMemo(() => {
    if (!summary || summary.totalPaidInvoices === 0) {
      return 0;
    }

    return Math.round(
      (summary.paidOnOrBeforeDueDate / summary.totalPaidInvoices) * 100,
    );
  }, [summary]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-md bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
              <History size={14} />
              Histórico
            </div>
            <h2 className="text-lg font-semibold text-slate-900">
              Pagamentos de {history?.debtor.name ?? debtorName}
            </h2>
            {history?.debtor.email && (
              <p className="mt-1 text-sm text-slate-500">
                {history.debtor.email}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="Fechar histórico"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {error && (
            <div className="flex items-start gap-3 rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              <AlertCircle className="mt-0.5 shrink-0" size={18} />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="animate-spin" size={18} />
              Carregando histórico de pagamentos
            </div>
          ) : payments.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 px-6 py-14 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md bg-slate-100 text-slate-400">
                <ReceiptText size={25} />
              </div>
              <h3 className="font-semibold text-slate-900">
                Nenhum pagamento registrado
              </h3>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                As faturas pagas deste devedor aparecerão aqui.
              </p>
            </div>
          ) : (
            <>
              <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-md border border-slate-200 px-4 py-3">
                  <p className="text-xs font-semibold uppercase text-slate-400">
                    Total pago
                  </p>
                  <p className="mt-2 text-xl font-bold text-slate-900">
                    {formatCurrency(summary?.totalPaidAmount ?? 0)}
                  </p>
                </div>
                <div className="rounded-md border border-slate-200 px-4 py-3">
                  <p className="text-xs font-semibold uppercase text-slate-400">
                    No prazo
                  </p>
                  <p className="mt-2 text-xl font-bold text-emerald-700">
                    {summary?.paidOnOrBeforeDueDate ?? 0}
                  </p>
                </div>
                <div className="rounded-md border border-slate-200 px-4 py-3">
                  <p className="text-xs font-semibold uppercase text-slate-400">
                    Em atraso
                  </p>
                  <p className="mt-2 text-xl font-bold text-rose-700">
                    {summary?.paidOverdue ?? 0}
                  </p>
                </div>
                <div className="rounded-md border border-slate-200 px-4 py-3">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase text-slate-400">
                    <TrendingUp size={13} />
                    Pontualidade
                  </p>
                  <p className="mt-2 text-xl font-bold text-slate-900">
                    {punctualityRate}%
                  </p>
                </div>
              </section>

              <section className="overflow-hidden rounded-md border border-slate-200">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50">
                      <tr>
                        <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-500">
                          Fatura
                        </th>
                        <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-500">
                          Valor
                        </th>
                        <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-500">
                          Vencimento
                        </th>
                        <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-500">
                          Pagamento
                        </th>
                        <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-500">
                          Pontualidade
                        </th>
                        <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-500">
                          Método
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {payments.map((payment) => {
                        const meta = TIMELINESS_META[payment.timeliness];
                        const Icon = meta.Icon;

                        return (
                          <tr key={payment.invoiceId}>
                            <td className="px-4 py-3">
                              <p className="max-w-48 truncate font-medium text-slate-900">
                                {payment.invoiceId}
                              </p>
                              {hasStudentData(payment) && (
                                <p className="mt-1 max-w-48 truncate text-xs text-slate-500">
                                  {[payment.studentName, payment.studentGroup]
                                    .filter((item): item is string =>
                                      Boolean(item),
                                    )
                                    .join(" / ")}
                                </p>
                              )}
                            </td>
                            <td className="px-4 py-3 font-semibold tabular-nums text-slate-900">
                              {formatCurrency(payment.amount)}
                            </td>
                            <td className="px-4 py-3 tabular-nums text-slate-600">
                              {formatDate(payment.dueDate)}
                            </td>
                            <td className="px-4 py-3 text-slate-600">
                              <p className="tabular-nums">
                                {formatDateTime(payment.paidAt)}
                              </p>
                              <p className="mt-1 text-xs text-slate-400">
                                {formatDate(payment.paidDate)}
                              </p>
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${meta.className}`}
                              >
                                <Icon size={13} />
                                {meta.label}
                              </span>
                              <p className="mt-1 text-xs text-slate-500">
                                {getTimingDetail(payment)}
                              </p>
                            </td>
                            <td className="px-4 py-3 text-slate-600">
                              {getPaymentMethodLabel(payment.billingType)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
