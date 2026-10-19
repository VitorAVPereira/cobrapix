"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  CalendarClock,
  Loader2,
  PauseCircle,
  Pencil,
  PlayCircle,
  RefreshCw,
  Search,
  SearchX,
  X,
} from "lucide-react";
import type {
  BillingMethod,
  BillingSettings,
  InvoiceListBillingType,
  RecurringInvoice,
  RecurringInvoiceListResponse,
  RecurringInvoiceStatus,
} from "@/lib/api-client";
import { formatBillingMethodRateLabel } from "@/lib/billing-fees";
import { useApiClient } from "@/lib/use-api-client";
import { formatWhatsAppNumber } from "@/lib/whatsapp-number";
import { formatDebtorDocument } from "@/lib/debtor-document";
import { billingMethodLabel, plural } from "@/lib/list-format";
import { TablePagination } from "@/components/ui/TablePagination";
import { LateTermsFields } from "@/components/features/LateTermsFields";
import {
  EMPTY_LATE_TERMS,
  isIndividualDocument,
  lateTermsFormFromValues,
  parseLateTermsForm,
  type LateTermsFormValues,
} from "@/lib/late-terms";

interface EditForm {
  amount: string;
  billingType: BillingMethod;
  dueDay: string;
  lateTerms: LateTermsFormValues;
}

interface ApiErrorData {
  details?: string[];
  message?: string;
}

interface RecurringQuery {
  search: string;
  status: RecurringInvoiceStatus | "";
  billingType: InvoiceListBillingType | "";
  page: number;
  pageSize: number;
}

const STATUS_OPTIONS: { value: RecurringInvoiceStatus | ""; label: string }[] = [
  { value: "", label: "Todas as situações" },
  { value: "ACTIVE", label: "Ativas" },
  { value: "PAUSED", label: "Pausadas" },
];

const BILLING_OPTIONS: { value: InvoiceListBillingType | ""; label: string }[] = [
  { value: "", label: "Todas as formas" },
  { value: "PIX", label: "Pix" },
  { value: "BOLETO", label: "Boleto" },
  { value: "CREDIT_CARD", label: "Cartão" },
];

const PAGE_SIZES = [20, 50, 100];

const fieldClass =
  "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

/** Filters live in the URL: a reload or the back button returns to the same list. */
function readQuery(params: URLSearchParams): RecurringQuery {
  const pick = <T extends string>(value: string | null, options: { value: T }[], fallback: T): T =>
    options.find((option) => option.value === value)?.value ?? fallback;
  const page = Number(params.get("page"));
  const pageSize = Number(params.get("pageSize"));
  return {
    search: params.get("search") ?? "",
    status: pick(params.get("status"), STATUS_OPTIONS, ""),
    billingType: pick(params.get("billingType"), BILLING_OPTIONS, ""),
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : 20,
  };
}

function writeQuery(query: RecurringQuery): string {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.status) params.set("status", query.status);
  if (query.billingType) params.set("billingType", query.billingType);
  if (query.page > 1) params.set("page", String(query.page));
  if (query.pageSize !== 20) params.set("pageSize", String(query.pageSize));
  const value = params.toString();
  return value ? `?${value}` : "";
}

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
    return "—";
  }

  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

/** The next invoice: the one already generated and open, or the next one to be generated. */
function nextInvoiceDate(recurrence: RecurringInvoice): string {
  return formatDate(recurrence.pendingInvoice?.dueDate ?? recurrence.nextDueDate);
}

function StatusBadge({ status }: { status: RecurringInvoiceStatus }) {
  return status === "ACTIVE" ? (
    <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
      Ativa
    </span>
  ) : (
    <span className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
      Pausada
    </span>
  );
}

function RecorrentesContent() {
  const apiClient = useApiClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useMemo(
    () => readQuery(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const [response, setResponse] = useState<RecurringInvoiceListResponse | null>(null);
  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(query.search);
  const [selectedRecurrence, setSelectedRecurrence] = useState<RecurringInvoice | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    amount: "",
    billingType: "BOLIX",
    dueDay: "10",
    lateTerms: EMPTY_LATE_TERMS,
  });
  const [editError, setEditError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Pausing or activating changes what gets charged, so it is confirmed first.
  const [statusTarget, setStatusTarget] = useState<RecurringInvoice | null>(null);
  const [changingStatus, setChangingStatus] = useState(false);
  const listRequest = useRef<AbortController | null>(null);

  const hasFilters = Boolean(query.search || query.status || query.billingType);

  const updateQuery = useCallback(
    (patch: Partial<RecurringQuery>): void => {
      // Any filter change starts again from the first page.
      const next = { ...query, page: 1, ...patch };
      router.replace(`${pathname}${writeQuery(next)}`, { scroll: false });
    },
    [pathname, query, router],
  );

  function clearFilters(): void {
    setSearchInput("");
    updateQuery({ search: "", status: "", billingType: "" });
  }

  // The search reaches the URL (and the API) once the user stops typing.
  useEffect(() => {
    if (searchInput.trim() === query.search) return;
    const timer = window.setTimeout(() => updateQuery({ search: searchInput.trim() }), 350);
    return () => window.clearTimeout(timer);
  }, [query.search, searchInput, updateQuery]);

  const fetchRecurrences = useCallback(async (): Promise<void> => {
    // A slower answer for a previous filter must not replace the current list.
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    setLoading(true);
    try {
      const result = await apiClient.getRecurringInvoices(
        {
          page: query.page,
          pageSize: query.pageSize,
          search: query.search || undefined,
          status: query.status || undefined,
          billingType: query.billingType || undefined,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setResponse(result);
      setListError(null);
    } catch {
      if (controller.signal.aborted) return;
      setListError("Não foi possível carregar as recorrências.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [apiClient, query]);

  useEffect(() => {
    void fetchRecurrences();
  }, [fetchRecurrences]);

  // A saved link or a shorter list can point past the last page.
  useEffect(() => {
    if (!response || loading) return;
    const lastPage = Math.max(1, Math.ceil(response.total / query.pageSize));
    if (query.page > lastPage) updateQuery({ page: lastPage });
  }, [loading, query.page, query.pageSize, response, updateQuery]);

  useEffect(() => () => listRequest.current?.abort(), []);

  // Payment methods and fees change rarely: loaded once.
  useEffect(() => {
    let active = true;
    apiClient
      .getBillingSettings()
      .then((result) => {
        if (active) setSettings(result);
      })
      .catch(() => {
        // Without settings the form offers Bolix, the default method.
      });
    return () => {
      active = false;
    };
  }, [apiClient]);

  const enabledBillingMethods: BillingMethod[] = settings?.enabledBillingMethods.length
    ? settings.enabledBillingMethods.filter((method) => method !== "BOLETO")
    : ["BOLIX"];

  function openEditModal(recurrence: RecurringInvoice): void {
    const billingType = enabledBillingMethods.includes(recurrence.billingType)
      ? recurrence.billingType
      : (enabledBillingMethods[0] ?? "BOLIX");

    setSelectedRecurrence(recurrence);
    setEditError(null);
    setEditForm({
      amount: String(recurrence.amount),
      billingType,
      dueDay: String(recurrence.dueDay),
      lateTerms: recurrence.lateTerms
        ? lateTermsFormFromValues({
            fine: recurrence.lateTerms.late_fine_percentage,
            interest: recurrence.lateTerms.late_interest_monthly_percentage,
            days: recurrence.lateTerms.payment_days_after_due,
          })
        : EMPTY_LATE_TERMS,
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
      setEditError("Informe um valor recorrente válido.");
      return;
    }

    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
      setEditError("Informe um dia de vencimento entre 1 e 31.");
      return;
    }

    // An empty field keeps the current value of the recurrence.
    const parsedLateTerms = parseLateTermsForm(editForm.lateTerms);
    if ("error" in parsedLateTerms) {
      setEditError(parsedLateTerms.error);
      return;
    }

    setIsSaving(true);
    setEditError(null);

    try {
      await apiClient.updateRecurringInvoice(selectedRecurrence.recurrenceId, {
        amount,
        billingType: editForm.billingType,
        dueDay,
        lateFinePercentage: parsedLateTerms.terms.fine ?? undefined,
        lateInterestMonthlyPercentage:
          parsedLateTerms.terms.interest ?? undefined,
        paymentDaysAfterDue: parsedLateTerms.terms.days ?? undefined,
      });
      closeEditModal();
      await fetchRecurrences();
    } catch (error: unknown) {
      setEditError(
        getErrorMessage(error, "Não foi possível salvar a recorrência."),
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmStatusChange(): Promise<void> {
    if (!statusTarget) return;
    setChangingStatus(true);
    setActionError(null);
    try {
      if (statusTarget.status === "ACTIVE") {
        await apiClient.pauseRecurringInvoice(statusTarget.recurrenceId);
      } else {
        await apiClient.activateRecurringInvoice(statusTarget.recurrenceId);
      }
      setStatusTarget(null);
      await fetchRecurrences();
    } catch (error: unknown) {
      setStatusTarget(null);
      setActionError(getErrorMessage(error, "Não foi possível atualizar a situação."));
    } finally {
      setChangingStatus(false);
    }
  }

  const summary = response?.summary;

  return (
    <main className="min-h-full bg-slate-50">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 lg:p-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Recorrentes</h1>
            <p className="mt-1 text-sm text-slate-500">
              Cobranças mensais: valor, vencimento, forma de pagamento e situação de cada cliente.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void fetchRecurrences()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : undefined} />
            Atualizar
          </button>
        </header>

        {summary && (
          <section aria-label="Resumo" className="grid gap-3 sm:grid-cols-3">
            {[
              ["Ativas", plural(summary.active, "recorrência", "recorrências")],
              ["Valor mensal das ativas", formatCurrency(summary.activeMonthlyAmount)],
              ["Pausadas", plural(summary.paused, "recorrência", "recorrências")],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs font-medium text-slate-500">{label}</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{value}</p>
              </div>
            ))}
          </section>
        )}

        {actionError && (
          <div role="alert" className="flex items-start gap-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 shrink-0" size={18} />
            <span>{actionError}</span>
          </div>
        )}

        <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
          <div className="grid gap-3 border-b border-slate-200 p-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_12rem_12rem]">
            <label className="relative block md:col-span-2 xl:col-span-1">
              <span className="sr-only">Buscar recorrências</span>
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Buscar por cliente, CPF/CNPJ, WhatsApp ou e-mail"
                className={`${fieldClass} pl-9`}
              />
            </label>
            <label>
              <span className="sr-only">Filtrar por situação</span>
              <select
                value={query.status}
                onChange={(event) => updateQuery({ status: event.target.value as RecurringQuery["status"] })}
                className={fieldClass}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Filtrar por forma de pagamento</span>
              <select
                value={query.billingType}
                onChange={(event) => updateQuery({ billingType: event.target.value as RecurringQuery["billingType"] })}
                className={fieldClass}
              >
                {BILLING_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>

          {!response && loading ? (
            <div className="flex min-h-64 flex-col items-center justify-center text-slate-500">
              <Loader2 className="mb-3 animate-spin" size={30} />
              <p className="text-sm">Carregando recorrências...</p>
            </div>
          ) : listError ? (
            <div role="alert" className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center">
              <AlertCircle size={28} className="text-rose-500" />
              <p className="text-sm text-slate-700">{listError}</p>
              <button
                type="button"
                onClick={() => void fetchRecurrences()}
                className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Tentar de novo
              </button>
            </div>
          ) : response && response.data.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center">
              {hasFilters ? (
                <>
                  <SearchX size={28} className="text-slate-400" />
                  <p className="text-sm text-slate-600">Nenhuma recorrência encontrada com estes filtros.</p>
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Limpar filtros
                  </button>
                </>
              ) : (
                <>
                  <CalendarClock size={28} className="text-slate-400" />
                  <p className="font-semibold text-slate-900">Nenhuma recorrência</p>
                  <p className="max-w-md text-sm text-slate-500">
                    Marque uma nova cobrança como recorrente na tela de Cobranças para iniciar a agenda mensal.
                  </p>
                </>
              )}
            </div>
          ) : response ? (
            <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
              <div className="hidden overflow-x-auto xl:block">
                <table className="w-full min-w-[880px] table-fixed text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Cliente</th>
                      <th className="w-32 px-4 py-2.5 text-right">Valor</th>
                      <th className="w-28 px-4 py-2.5">Forma</th>
                      <th className="w-28 px-4 py-2.5">Vencimento</th>
                      <th className="w-32 whitespace-nowrap px-4 py-2.5">Próxima fatura</th>
                      <th className="w-28 px-4 py-2.5">Situação</th>
                      <th className="w-24 px-4 py-2.5"><span className="sr-only">Ações</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {response.data.map((recurrence) => (
                      <tr key={recurrence.recurrenceId}>
                        <td className="px-4 py-2.5">
                          <p title={recurrence.debtor.name} className="truncate font-medium text-slate-900">
                            {recurrence.debtor.name}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            {formatDebtorDocument(recurrence.debtor.document ?? null)} ·{" "}
                            {formatWhatsAppNumber(recurrence.debtor.phone_number)}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                          {formatCurrency(recurrence.amount)}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">{billingMethodLabel(recurrence.billingType)}</td>
                        <td className="px-4 py-2.5 text-slate-600">Dia {recurrence.dueDay}</td>
                        <td className="px-4 py-2.5 tabular-nums text-slate-600">{nextInvoiceDate(recurrence)}</td>
                        <td className="px-4 py-2.5"><StatusBadge status={recurrence.status} /></td>
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => openEditModal(recurrence)}
                              title="Editar"
                              aria-label={`Editar recorrência de ${recurrence.debtor.name}`}
                              className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setStatusTarget(recurrence)}
                              title={recurrence.status === "ACTIVE" ? "Pausar" : "Ativar"}
                              aria-label={`${recurrence.status === "ACTIVE" ? "Pausar" : "Ativar"} recorrência de ${recurrence.debtor.name}`}
                              className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                            >
                              {recurrence.status === "ACTIVE" ? <PauseCircle size={16} /> : <PlayCircle size={16} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="divide-y divide-slate-100 xl:hidden">
                {response.data.map((recurrence) => (
                  <li key={recurrence.recurrenceId} className="space-y-1.5 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{recurrence.debtor.name}</p>
                        <p className="truncate text-xs text-slate-500">
                          {formatDebtorDocument(recurrence.debtor.document ?? null)}
                        </p>
                      </div>
                      <p className="shrink-0 font-semibold tabular-nums text-slate-900">{formatCurrency(recurrence.amount)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                      <span>{billingMethodLabel(recurrence.billingType)}</span>
                      <span aria-hidden>·</span>
                      <span>Dia {recurrence.dueDay}</span>
                      <span aria-hidden>·</span>
                      <span>Próxima {nextInvoiceDate(recurrence)}</span>
                      <StatusBadge status={recurrence.status} />
                    </div>
                    <div className="flex gap-4 pt-0.5">
                      <button
                        type="button"
                        onClick={() => openEditModal(recurrence)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700"
                      >
                        <Pencil size={14} />
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatusTarget(recurrence)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700"
                      >
                        {recurrence.status === "ACTIVE" ? <PauseCircle size={14} /> : <PlayCircle size={14} />}
                        {recurrence.status === "ACTIVE" ? "Pausar" : "Ativar"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              <TablePagination
                page={query.page}
                pageSize={query.pageSize}
                total={response.total}
                pageSizeLabel="Recorrências por página"
                onChange={(next) => updateQuery(next)}
              />
            </div>
          ) : null}
        </section>
      </div>

      {statusTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="status-title" className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h2 id="status-title" className="text-lg font-semibold text-slate-900">
              {statusTarget.status === "ACTIVE" ? "Pausar" : "Ativar"} a recorrência de {statusTarget.debtor.name}?
            </h2>
            {statusTarget.status === "ACTIVE" ? (
              <p className="mt-2 text-sm text-slate-600">
                Nenhuma nova fatura será gerada enquanto estiver pausada.
                {statusTarget.pendingInvoice &&
                  ` A fatura de ${formatDate(statusTarget.pendingInvoice.dueDate)} (${formatCurrency(statusTarget.pendingInvoice.amount)}) já foi gerada e continua em aberto.`}
              </p>
            ) : (
              <p className="mt-2 text-sm text-slate-600">
                As faturas de {formatCurrency(statusTarget.amount)} com vencimento no dia {statusTarget.dueDay} voltam a ser
                geradas, e as que vencem nos próximos 30 dias são criadas agora.
              </p>
            )}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setStatusTarget(null)}
                disabled={changingStatus}
                className="rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmStatusChange()}
                disabled={changingStatus}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {changingStatus ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : statusTarget.status === "ACTIVE" ? (
                  <PauseCircle size={16} />
                ) : (
                  <PlayCircle size={16} />
                )}
                {statusTarget.status === "ACTIVE" ? "Pausar recorrência" : "Ativar recorrência"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedRecurrence && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="edit-title" className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-md bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 id="edit-title" className="font-semibold text-slate-900">
                  Editar recorrência
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedRecurrence.debtor.name}
                </p>
              </div>
              <button
                type="button"
                onClick={closeEditModal}
                className="rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
              {editError && (
                <div role="alert" className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 sm:col-span-2">
                  <AlertCircle className="mt-0.5 shrink-0" size={16} />
                  <span>{editError}</span>
                </div>
              )}
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
                  {enabledBillingMethods.map((method) => {
                    return (
                      <option key={method} value={method}>
                        {formatBillingMethodRateLabel(method, settings)}
                      </option>
                    );
                  })}
                </select>
              </label>

              <fieldset className="sm:col-span-2">
                <legend className="mb-2 text-sm font-semibold text-slate-800">
                  Multa, juros e prazo após o vencimento
                </legend>
                <LateTermsFields
                  idPrefix="recurrence-late-terms"
                  values={editForm.lateTerms}
                  disabled={isSaving}
                  onChange={(values) =>
                    setEditForm((currentForm) => ({
                      ...currentForm,
                      lateTerms: values,
                    }))
                  }
                  individualDebtor={isIndividualDocument(
                    selectedRecurrence.debtor.document,
                  )}
                />
                <p className="mt-2 text-xs text-slate-500">
                  Vale para as próximas faturas geradas; faturas já criadas
                  mantêm os valores.
                </p>
              </fieldset>
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
                Salvar alterações
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function DevedoresRecorrentesPage() {
  return (
    <Suspense fallback={null}>
      <RecorrentesContent />
    </Suspense>
  );
}
