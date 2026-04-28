"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Loader2,
  PauseCircle,
  Pencil,
  PlayCircle,
  Search,
  X,
} from "lucide-react";
import type {
  BillingMethod,
  BillingSettings,
  RecurringInvoice,
} from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";

interface EditForm {
  amount: string;
  billingType: BillingMethod;
  dueDay: string;
}

interface ApiErrorData {
  details?: string[];
  message?: string;
}

const paymentMethods: BillingMethod[] = ["PIX", "BOLETO", "BOLIX"];

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: ApiErrorData }).data;

    if (data?.details?.length) {
      return data.details.join(" | ");
    }

    if (data?.message) {
      return data.message;
    }
  }

  return fallback;
}

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
  return `${day}/${month}/${year}`;
}

function getMethodLabel(method: BillingMethod): string {
  if (method === "BOLETO") {
    return "Boleto";
  }

  if (method === "BOLIX") {
    return "Bolix";
  }

  return "PIX";
}

export default function DevedoresRecorrentesPage() {
  const apiClient = useApiClient();
  const [recurrences, setRecurrences] = useState<RecurringInvoice[]>([]);
  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [selectedRecurrence, setSelectedRecurrence] =
    useState<RecurringInvoice | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    amount: "",
    billingType: "PIX",
    dueDay: "10",
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchData = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setErrorMsg(null);

    try {
      const [recurringResponse, settingsResponse] = await Promise.all([
        apiClient.getRecurringInvoices(),
        apiClient.getBillingSettings(),
      ]);
      setRecurrences(recurringResponse);
      setSettings(settingsResponse);
    } catch (error: unknown) {
      setErrorMsg(
        getErrorMessage(error, "Nao foi possivel carregar recorrencias."),
      );
    } finally {
      setIsLoading(false);
    }
  }, [apiClient]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const filteredRecurrences = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return recurrences;
    }

    return recurrences.filter((recurrence) => {
      const fields = [
        recurrence.debtor.name,
        recurrence.debtor.phone_number,
        recurrence.debtor.email ?? "",
      ];

      return fields.some((field) => field.toLowerCase().includes(query));
    });
  }, [recurrences, searchQuery]);

  function openEditModal(recurrence: RecurringInvoice): void {
    setSelectedRecurrence(recurrence);
    setEditForm({
      amount: String(recurrence.amount),
      billingType: recurrence.billingType,
      dueDay: String(recurrence.dueDay),
    });
  }

  function closeEditModal(): void {
    setSelectedRecurrence(null);
    setIsSaving(false);
  }

  async function handleSave(): Promise<void> {
    if (!selectedRecurrence) {
      return;
    }

    const amount = Number(editForm.amount);
    const dueDay = Number(editForm.dueDay);

    if (!Number.isFinite(amount) || amount <= 0) {
      setErrorMsg("Informe um valor recorrente valido.");
      return;
    }

    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
      setErrorMsg("Informe um dia de vencimento entre 1 e 31.");
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);

    try {
      await apiClient.updateRecurringInvoice(selectedRecurrence.recurrenceId, {
        amount,
        billingType: editForm.billingType,
        dueDay,
      });
      closeEditModal();
      await fetchData();
    } catch (error: unknown) {
      setErrorMsg(
        getErrorMessage(error, "Nao foi possivel salvar a recorrencia."),
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleStatus(recurrence: RecurringInvoice): Promise<void> {
    setErrorMsg(null);

    try {
      if (recurrence.status === "ACTIVE") {
        await apiClient.pauseRecurringInvoice(recurrence.recurrenceId);
      } else {
        await apiClient.activateRecurringInvoice(recurrence.recurrenceId);
      }

      await fetchData();
    } catch (error: unknown) {
      setErrorMsg(
        getErrorMessage(error, "Nao foi possivel atualizar o status."),
      );
    }
  }

  return (
    <main className="min-h-full bg-slate-50">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Devedores Recorrentes
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Ajuste valor, vencimento, forma de pagamento e status das
              cobranças mensais.
            </p>
          </div>

          <div className="relative w-full xl:w-96">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              size={18}
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Pesquisar por devedor..."
              className="h-11 w-full rounded-md border border-slate-200 bg-white py-2 pl-10 pr-3 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            />
          </div>
        </header>

        {errorMsg && (
          <div className="flex items-start gap-3 rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 shrink-0" size={18} />
            <span>{errorMsg}</span>
          </div>
        )}

        {isLoading ? (
          <div className="flex min-h-80 flex-col items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500">
            <Loader2 className="mb-3 animate-spin" size={34} />
            <p className="text-sm">Carregando recorrencias...</p>
          </div>
        ) : filteredRecurrences.length > 0 ? (
          <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500">
                      Devedor
                    </th>
                    <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500">
                      Valor
                    </th>
                    <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500">
                      Pagamento
                    </th>
                    <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500">
                      Vencimento
                    </th>
                    <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500">
                      Proxima fatura
                    </th>
                    <th className="px-5 py-3 text-center text-xs font-semibold uppercase text-slate-500">
                      Status
                    </th>
                    <th className="px-5 py-3 text-center text-xs font-semibold uppercase text-slate-500">
                      Acoes
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRecurrences.map((recurrence) => (
                    <tr key={recurrence.recurrenceId}>
                      <td className="px-5 py-4">
                        <p className="font-semibold text-slate-900">
                          {recurrence.debtor.name}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {recurrence.debtor.phone_number}
                        </p>
                      </td>
                      <td className="px-5 py-4 font-semibold tabular-nums text-slate-900">
                        {formatCurrency(recurrence.amount)}
                      </td>
                      <td className="px-5 py-4 text-slate-600">
                        {getMethodLabel(recurrence.billingType)}
                      </td>
                      <td className="px-5 py-4 text-slate-600">
                        Dia {recurrence.dueDay}
                      </td>
                      <td className="px-5 py-4 text-slate-600">
                        {recurrence.pendingInvoice
                          ? formatDate(recurrence.pendingInvoice.dueDate)
                          : formatDate(recurrence.nextDueDate)}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex justify-center">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                              recurrence.status === "ACTIVE"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-slate-200 bg-slate-100 text-slate-600"
                            }`}
                          >
                            {recurrence.status === "ACTIVE" ? (
                              <CheckCircle2 size={13} />
                            ) : (
                              <PauseCircle size={13} />
                            )}
                            {recurrence.status === "ACTIVE" ? "Ativa" : "Pausada"}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEditModal(recurrence)}
                            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                          >
                            <Pencil size={14} />
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void toggleStatus(recurrence);
                            }}
                            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                          >
                            {recurrence.status === "ACTIVE" ? (
                              <PauseCircle size={14} />
                            ) : (
                              <PlayCircle size={14} />
                            )}
                            {recurrence.status === "ACTIVE" ? "Pausar" : "Ativar"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <div className="rounded-md border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-md bg-slate-100 text-slate-400">
              <CalendarClock size={28} />
            </div>
            <h2 className="font-semibold text-slate-900">
              Nenhum devedor recorrente
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
              Marque uma nova fatura como recorrente na tela de cobranças para
              iniciar a agenda mensal.
            </p>
          </div>
        )}
      </div>

      {selectedRecurrence && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-lg rounded-md bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="font-semibold text-slate-900">
                  Editar recorrencia
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedRecurrence.debtor.name}
                </p>
              </div>
              <button
                type="button"
                onClick={closeEditModal}
                className="rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                aria-label="Fechar modal"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase text-slate-500">
                  Valor (R$)
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editForm.amount}
                  onChange={(event) =>
                    setEditForm((currentForm) => ({
                      ...currentForm,
                      amount: event.target.value,
                    }))
                  }
                  className="h-11 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase text-slate-500">
                  Dia de vencimento
                </span>
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={editForm.dueDay}
                  onChange={(event) =>
                    setEditForm((currentForm) => ({
                      ...currentForm,
                      dueDay: event.target.value,
                    }))
                  }
                  className="h-11 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                />
              </label>

              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="text-xs font-semibold uppercase text-slate-500">
                  Forma de pagamento
                </span>
                <select
                  value={editForm.billingType}
                  onChange={(event) =>
                    setEditForm((currentForm) => ({
                      ...currentForm,
                      billingType: event.target.value as BillingMethod,
                    }))
                  }
                  className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                >
                  {paymentMethods.map((method) => {
                    const tariff = settings?.tariffs[method];
                    const label = getMethodLabel(method);

                    return (
                      <option key={method} value={method}>
                        {tariff ? `${label} - ${tariff.combinedLabel}` : label}
                      </option>
                    );
                  })}
                </select>
              </label>
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeEditModal}
                className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleSave();
                }}
                disabled={isSaving}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving && <Loader2 size={16} className="animate-spin" />}
                Salvar alteracoes
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
