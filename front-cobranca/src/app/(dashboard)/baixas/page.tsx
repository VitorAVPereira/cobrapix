"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  CheckCheck,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Search,
  SearchX,
} from "lucide-react";
import type {
  InvoiceListBillingType,
  PaymentNotificationFilter,
  PaymentNotificationItem,
  PaymentNotificationListResponse,
  PaymentNotificationState,
} from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";
import { formatDebtorDocument } from "@/lib/debtor-document";
import { TablePagination } from "@/components/ui/TablePagination";
import { PeriodSelect, readPeriod, writePeriod } from "@/components/ui/PeriodSelect";
import type { PeriodValue } from "@/components/ui/PeriodSelect";
import { billingMethodLabel, formatDateTime, plural } from "@/lib/list-format";

const STATE_OPTIONS: { value: PaymentNotificationState | ""; label: string }[] = [
  { value: "", label: "Todas as baixas" },
  { value: "unread", label: "Não lidas" },
  { value: "read", label: "Lidas" },
  { value: "email_failed", label: "E-mail não enviado" },
];

const BILLING_OPTIONS: { value: InvoiceListBillingType | ""; label: string }[] = [
  { value: "", label: "Todas as formas" },
  { value: "PIX", label: "Pix" },
  { value: "BOLETO", label: "Boleto" },
  { value: "CREDIT_CARD", label: "Cartão" },
];

const PAGE_SIZES = [20, 50, 100];

interface NotificationQuery extends PeriodValue {
  search: string;
  state: PaymentNotificationState | "";
  billingType: InvoiceListBillingType | "";
  page: number;
  pageSize: number;
}

const emptyResponse: PaymentNotificationListResponse = {
  data: [],
  unreadCount: 0,
  total: 0,
  page: 1,
  pageSize: 20,
  filteredUnread: 0,
  asOf: "",
};

const selectClass =
  "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

/** Filters live in the URL: a reload or the back button returns to the same list. */
function readQuery(params: URLSearchParams): NotificationQuery {
  const pick = <T extends string>(value: string | null, options: { value: T }[], fallback: T): T =>
    options.find((option) => option.value === value)?.value ?? fallback;
  const page = Number(params.get("page"));
  const pageSize = Number(params.get("pageSize"));
  return {
    search: params.get("search") ?? "",
    state: pick(params.get("state"), STATE_OPTIONS, ""),
    billingType: pick(params.get("billingType"), BILLING_OPTIONS, ""),
    // Without a period, any date.
    ...readPeriod(params, "", null),
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : 20,
  };
}

function writeQuery(query: NotificationQuery): string {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.state) params.set("state", query.state);
  if (query.billingType) params.set("billingType", query.billingType);
  writePeriod(params, query, "", null);
  if (query.page > 1) params.set("page", String(query.page));
  if (query.pageSize !== 20) params.set("pageSize", String(query.pageSize));
  const value = params.toString();
  return value ? `?${value}` : "";
}

function toFilter(query: NotificationQuery): PaymentNotificationFilter {
  return {
    search: query.search || undefined,
    state: query.state || undefined,
    billingType: query.billingType || undefined,
    period: query.period || undefined,
    startDate: query.startDate || undefined,
    endDate: query.endDate || undefined,
  };
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

/** What happened to the e-mail alert; reading the baixa does not change it. */
function EmailStatus({ notification }: { notification: PaymentNotificationItem }) {
  if (notification.sentAt) {
    return (
      <span
        title={`Enviado para ${notification.recipientEmails.join(", ")} em ${formatDateTime(notification.sentAt)}`}
        className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
      >
        Enviado
      </span>
    );
  }
  if (notification.errorMessage) {
    return (
      <span
        title={notification.errorMessage}
        className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700"
      >
        Não enviado
      </span>
    );
  }
  return (
    <span
      title="O aviso por e-mail está desligado ou ainda não foi enviado."
      className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500"
    >
      Sem envio
    </span>
  );
}

function ClientCell({ notification, unread }: { notification: PaymentNotificationItem; unread: boolean }) {
  const student = [notification.studentName, notification.studentEnrollment && `Matrícula ${notification.studentEnrollment}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="min-w-0">
      <p className={`flex items-center gap-2 truncate ${unread ? "font-semibold text-slate-900" : "text-slate-700"}`}>
        {unread && (
          <>
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
            <span className="sr-only">Não lida:</span>
          </>
        )}
        <span className="truncate">{notification.debtorName}</span>
      </p>
      <p className="truncate text-xs text-slate-500">
        {formatDebtorDocument(notification.debtorDocument)}
        {student && ` · ${student}`}
      </p>
    </div>
  );
}

function BaixasContent() {
  const apiClient = useApiClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useMemo(
    () => readQuery(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const [response, setResponse] = useState<PaymentNotificationListResponse>(emptyResponse);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(query.search);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [markingIds, setMarkingIds] = useState<Set<string>>(new Set());
  const [confirmAll, setConfirmAll] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const listRequest = useRef<AbortController | null>(null);

  const hasFilters = Boolean(query.search || query.state || query.billingType || query.period);

  const updateQuery = useCallback(
    (patch: Partial<NotificationQuery>): void => {
      // Any filter change starts again from the first page.
      const next = { ...query, page: 1, ...patch };
      router.replace(`${pathname}${writeQuery(next)}`, { scroll: false });
    },
    [pathname, query, router],
  );

  function clearFilters(): void {
    setSearchInput("");
    updateQuery({ search: "", state: "", billingType: "", period: "", startDate: "", endDate: "" });
  }

  // The search reaches the URL (and the API) once the user stops typing.
  useEffect(() => {
    if (searchInput.trim() === query.search) return;
    const timer = window.setTimeout(() => updateQuery({ search: searchInput.trim() }), 350);
    return () => window.clearTimeout(timer);
  }, [query.search, searchInput, updateQuery]);

  const fetchNotifications = useCallback(async (): Promise<void> => {
    // A slower answer for a previous filter must not replace the current list.
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    setLoading(true);

    try {
      const result = await apiClient.getPaymentNotifications(
        { ...toFilter(query), page: query.page, pageSize: query.pageSize },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setResponse(result);
      setListError(null);
      // A selection only makes sense for the rows on screen.
      setSelected(new Set());
    } catch {
      if (controller.signal.aborted) return;
      setListError("Não foi possível carregar as baixas.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [apiClient, query]);

  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  // A saved link or a shorter list can point past the last page.
  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(response.total / query.pageSize));
    if (!loading && query.page > lastPage) updateQuery({ page: lastPage });
  }, [loading, query.page, query.pageSize, response.total, updateQuery]);

  useEffect(() => () => listRequest.current?.abort(), []);

  const unreadOnPage = response.data.filter((item) => item.status !== "READ");
  const allPageSelected = unreadOnPage.length > 0 && unreadOnPage.every((item) => selected.has(item.id));

  function toggle(id: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePage(): void {
    setSelected(allPageSelected ? new Set() : new Set(unreadOnPage.map((item) => item.id)));
  }

  async function markIds(ids: string[]): Promise<void> {
    setMarkingIds(new Set(ids));
    setActionError(null);
    setSuccess(null);
    try {
      const { count: changed } = await apiClient.markPaymentNotificationsAsRead({ ids });
      const readAt = new Date().toISOString();
      // Rows stay where they are, now read, so the list does not jump.
      setResponse((current) => ({
        ...current,
        data: current.data.map((item) =>
          ids.includes(item.id) && item.status !== "READ" ? { ...item, status: "READ", readAt } : item,
        ),
        unreadCount: Math.max(current.unreadCount - changed, 0),
        filteredUnread: Math.max(current.filteredUnread - changed, 0),
      }));
      setSelected(new Set());
      if (ids.length > 1) setSuccess(`${plural(changed, "baixa marcada", "baixas marcadas")} como lida${changed === 1 ? "" : "s"}.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Não foi possível marcar como lida.");
    } finally {
      setMarkingIds(new Set());
    }
  }

  async function markAll(): Promise<void> {
    setMarkingAll(true);
    setActionError(null);
    setSuccess(null);
    try {
      const { count: changed } = await apiClient.markPaymentNotificationsAsRead({
        ...toFilter(query),
        asOf: response.asOf,
      });
      setConfirmAll(false);
      setSuccess(`${plural(changed, "baixa marcada", "baixas marcadas")} como lida${changed === 1 ? "" : "s"}.`);
      await fetchNotifications();
    } catch (error) {
      setConfirmAll(false);
      setActionError(error instanceof Error ? error.message : "Não foi possível marcar as baixas como lidas.");
    } finally {
      setMarkingAll(false);
    }
  }

  const firstLoad = loading && response.asOf === "" && !listError;

  return (
    <main className="min-h-full bg-slate-50">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 lg:p-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight text-slate-900">
              Baixas
              {response.unreadCount > 0 && (
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                  {plural(response.unreadCount, "nova", "novas")}
                </span>
              )}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Pagamentos confirmados e avisos enviados por e-mail.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void fetchNotifications()}
              disabled={loading}
              className="inline-flex whitespace-nowrap items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : undefined} />
              Atualizar
            </button>
            {response.filteredUnread > 0 && (
              <button
                type="button"
                onClick={() => setConfirmAll(true)}
                className="inline-flex whitespace-nowrap items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
              >
                <CheckCheck size={16} />
                Marcar todas como lidas
              </button>
            )}
          </div>
        </header>

        {actionError && (
          <div role="alert" className="flex items-start gap-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 shrink-0" size={18} />
            <span>{actionError}</span>
          </div>
        )}
        {success && (
          <div role="status" className="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            <CheckCircle2 className="mt-0.5 shrink-0" size={18} />
            <span>{success}</span>
          </div>
        )}

        <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
          <div className="grid gap-3 border-b border-slate-200 p-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_12rem_11rem_12rem]">
            <label className="relative block md:col-span-2 xl:col-span-1">
              <span className="sr-only">Buscar baixas</span>
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Buscar por cliente, CPF/CNPJ, e-mail ou aluno"
                className={`${selectClass} pl-9`}
              />
            </label>
            <label>
              <span className="sr-only">Filtrar por situação</span>
              <select
                value={query.state}
                onChange={(event) => updateQuery({ state: event.target.value as NotificationQuery["state"] })}
                className={selectClass}
              >
                {STATE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Filtrar por forma de pagamento</span>
              <select
                value={query.billingType}
                onChange={(event) => updateQuery({ billingType: event.target.value as NotificationQuery["billingType"] })}
                className={selectClass}
              >
                {BILLING_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <PeriodSelect
              value={query}
              onChange={(period) => updateQuery(period)}
              datesClassName="md:col-span-2 xl:col-span-4"
            />
          </div>

          {selected.size > 0 && (
            <div className="flex flex-col gap-2 border-b border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800 sm:flex-row sm:items-center sm:justify-between">
              <span className="font-medium">{plural(selected.size, "baixa selecionada", "baixas selecionadas")}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="rounded-md px-3 py-1.5 font-semibold text-emerald-800 hover:bg-emerald-100"
                >
                  Limpar seleção
                </button>
                <button
                  type="button"
                  onClick={() => void markIds([...selected])}
                  disabled={markingIds.size > 0}
                  className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {markingIds.size > 1 ? <Loader2 size={15} className="animate-spin" /> : <CheckCheck size={15} />}
                  Marcar como lidas
                </button>
              </div>
            </div>
          )}

          {firstLoad ? (
            <div className="flex min-h-64 flex-col items-center justify-center text-slate-500">
              <Loader2 className="mb-3 animate-spin" size={30} />
              <p className="text-sm">Carregando baixas...</p>
            </div>
          ) : listError ? (
            <div role="alert" className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center">
              <AlertCircle size={28} className="text-rose-500" />
              <p className="text-sm text-slate-700">{listError}</p>
              <button
                type="button"
                onClick={() => void fetchNotifications()}
                className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Tentar de novo
              </button>
            </div>
          ) : response.data.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center">
              {hasFilters ? (
                <>
                  <SearchX size={28} className="text-slate-400" />
                  <p className="text-sm text-slate-600">Nenhuma baixa encontrada com estes filtros.</p>
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
                  <CheckCircle2 size={28} className="text-slate-400" />
                  <p className="font-semibold text-slate-900">Nenhuma baixa registrada</p>
                  <p className="max-w-md text-sm text-slate-500">
                    Quando um pagamento for confirmado, a baixa aparece aqui.
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[900px] table-fixed text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="w-12 px-4 py-2.5">
                        <input
                          type="checkbox"
                          checked={allPageSelected}
                          onChange={togglePage}
                          disabled={unreadOnPage.length === 0}
                          aria-label="Selecionar as não lidas desta página"
                          className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                        />
                      </th>
                      <th className="px-4 py-2.5">Cliente</th>
                      <th className="w-36 px-4 py-2.5 text-right">Valor</th>
                      <th className="w-28 px-4 py-2.5">Forma</th>
                      <th className="w-40 px-4 py-2.5">Pago em</th>
                      <th className="w-40 whitespace-nowrap px-4 py-2.5">Aviso por e-mail</th>
                      <th className="w-16 px-4 py-2.5"><span className="sr-only">Ações</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {response.data.map((notification) => {
                      const unread = notification.status !== "READ";
                      return (
                        <tr key={notification.id} className={unread ? "bg-emerald-50/30" : undefined}>
                          <td className="px-4 py-2.5">
                            {unread && (
                              <input
                                type="checkbox"
                                checked={selected.has(notification.id)}
                                onChange={() => toggle(notification.id)}
                                aria-label={`Selecionar ${notification.debtorName}`}
                                className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                              />
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <ClientCell notification={notification} unread={unread} />
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                            {formatBRL(notification.amount)}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">
                            {billingMethodLabel(notification.billingType)}
                          </td>
                          <td className="px-4 py-2.5 tabular-nums text-slate-600">{formatDateTime(notification.paidAt)}</td>
                          <td className="px-4 py-2.5"><EmailStatus notification={notification} /></td>
                          <td className="px-4 py-2.5 text-right">
                            {unread && (
                              <button
                                type="button"
                                onClick={() => void markIds([notification.id])}
                                disabled={markingIds.has(notification.id)}
                                title="Marcar como lida"
                                aria-label={`Marcar baixa de ${notification.debtorName} como lida`}
                                className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-emerald-700 disabled:opacity-50"
                              >
                                {markingIds.has(notification.id) ? <Loader2 size={16} className="animate-spin" /> : <CheckCheck size={16} />}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <ul className="divide-y divide-slate-100 lg:hidden">
                {response.data.map((notification) => {
                  const unread = notification.status !== "READ";
                  return (
                    <li key={notification.id} className={`flex gap-3 px-4 py-3 ${unread ? "bg-emerald-50/30" : ""}`}>
                      <div className="w-4 shrink-0 pt-1">
                        {unread && (
                          <input
                            type="checkbox"
                            checked={selected.has(notification.id)}
                            onChange={() => toggle(notification.id)}
                            aria-label={`Selecionar ${notification.debtorName}`}
                            className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-start justify-between gap-3">
                          <ClientCell notification={notification} unread={unread} />
                          <p className="shrink-0 font-semibold tabular-nums text-slate-900">{formatBRL(notification.amount)}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                          <span>{billingMethodLabel(notification.billingType)}</span>
                          <span aria-hidden>·</span>
                          <span>{formatDateTime(notification.paidAt)}</span>
                          <EmailStatus notification={notification} />
                        </div>
                        {notification.errorMessage && !notification.sentAt && (
                          <p className="text-xs text-rose-600">{notification.errorMessage}</p>
                        )}
                        {unread && (
                          <button
                            type="button"
                            onClick={() => void markIds([notification.id])}
                            disabled={markingIds.has(notification.id)}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 disabled:opacity-50"
                          >
                            <CheckCheck size={14} />
                            Marcar como lida
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              <TablePagination
                page={query.page}
                pageSize={query.pageSize}
                total={response.total}
                pageSizeLabel="Baixas por página"
                onChange={(next) => updateQuery(next)}
              />
            </div>
          )}
        </section>
      </div>

      {confirmAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="confirm-all-title" className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h2 id="confirm-all-title" className="text-lg font-semibold text-slate-900">
              Marcar {plural(response.filteredUnread, "baixa", "baixas")} como lida{response.filteredUnread === 1 ? "" : "s"}?
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {hasFilters
                ? "Vale para todas as baixas não lidas destes filtros, inclusive as das outras páginas."
                : "Vale para todas as baixas não lidas, inclusive as das outras páginas."}{" "}
              Pagamentos que chegarem depois continuam como novos.
            </p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setConfirmAll(false)}
                disabled={markingAll}
                className="rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void markAll()}
                disabled={markingAll}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {markingAll ? <Loader2 size={16} className="animate-spin" /> : <CheckCheck size={16} />}
                Marcar como lidas
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function PaymentNotificationsPage() {
  return (
    <Suspense fallback={null}>
      <BaixasContent />
    </Suspense>
  );
}
