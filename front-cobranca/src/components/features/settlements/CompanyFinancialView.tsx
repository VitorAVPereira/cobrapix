"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Loader2, RefreshCw, Search, SearchX, Wallet } from "lucide-react";
import { useApiClient } from "@/lib/use-api-client";
import type { CompanyFinancialProfile } from "@/lib/financial-activation";
import { formatCents } from "@/lib/settlements";
import type {
  CompanyReceipt,
  CompanyReceipts,
  CompanyReceiptSituationFilter,
  CompanyReceiptsQuery,
} from "@/lib/settlements";
import { formatDebtorDocument } from "@/lib/debtor-document";
import { billingMethodLabel, formatDateTime } from "@/lib/list-format";
import { TablePagination } from "@/components/ui/TablePagination";
import { PeriodSelect, readPeriod, writePeriod } from "@/components/ui/PeriodSelect";
import type { PeriodValue } from "@/components/ui/PeriodSelect";

const SITUATIONS: Record<CompanyReceipt["situation"], { label: string; title?: string; className: string }> = {
  RECEIVED: { label: "Recebido", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  IN_REVIEW: {
    label: "Em análise",
    title: "Em análise pela CifraMais",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  REFUNDED: { label: "Devolvido", className: "border-rose-200 bg-rose-50 text-rose-700" },
  PARTIALLY_REFUNDED: {
    label: "Devolvido em parte",
    className: "border-rose-200 bg-rose-50 text-rose-700",
  },
};

const SITUATION_OPTIONS: { value: CompanyReceiptSituationFilter | ""; label: string }[] = [
  { value: "", label: "Todas as situações" },
  { value: "RECEIVED", label: "Recebidas" },
  { value: "IN_REVIEW", label: "Em análise" },
  { value: "REFUNDED", label: "Com devolução" },
];

const BILLING_OPTIONS: { value: NonNullable<CompanyReceiptsQuery["billingType"]> | ""; label: string }[] = [
  { value: "", label: "Todas as formas" },
  { value: "PIX", label: "Pix" },
  { value: "BOLETO", label: "Boleto" },
  { value: "CREDIT_CARD", label: "Cartão" },
];

const MODE_LABELS: Record<string, string> = {
  CUSTOMER_ACCOUNT: "Conta Efí da própria empresa",
  PLATFORM_ACCOUNT: "Conta CifraMais",
};

const PAGE_SIZES = [20, 50, 100];
// The screen opens on the current month; "all" in the URL is the whole history.
const DEFAULT_PERIOD = "month";
const ANY_PERIOD = "all";

interface ReceiptsQuery extends PeriodValue {
  search: string;
  situation: CompanyReceiptSituationFilter | "";
  billingType: NonNullable<CompanyReceiptsQuery["billingType"]> | "";
  page: number;
  pageSize: number;
}

const fieldClass =
  "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

/** Filters live in the URL: a reload or the back button returns to the same list. */
function readQuery(params: URLSearchParams): ReceiptsQuery {
  const pick = <T extends string>(value: string | null, options: { value: T }[], fallback: T): T =>
    options.find((option) => option.value === value)?.value ?? fallback;
  const page = Number(params.get("page"));
  const pageSize = Number(params.get("pageSize"));
  return {
    search: params.get("search") ?? "",
    situation: pick(params.get("situation"), SITUATION_OPTIONS, ""),
    billingType: pick(params.get("billingType"), BILLING_OPTIONS, ""),
    ...readPeriod(params, DEFAULT_PERIOD, ANY_PERIOD),
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : 20,
  };
}

function writeQuery(query: ReceiptsQuery): string {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.situation) params.set("situation", query.situation);
  if (query.billingType) params.set("billingType", query.billingType);
  writePeriod(params, query, DEFAULT_PERIOD, ANY_PERIOD);
  if (query.page > 1) params.set("page", String(query.page));
  if (query.pageSize !== 20) params.set("pageSize", String(query.pageSize));
  const value = params.toString();
  return value ? `?${value}` : "";
}

function day(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("pt-BR") : "—";
}

function SituationBadge({ row }: { row: CompanyReceipt }) {
  const situation = SITUATIONS[row.situation];
  return (
    <span
      title={situation.title}
      className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${situation.className}`}
    >
      {situation.label}
    </span>
  );
}

// What the company sees about its own money. Read-only: account,
// credentials, fees and reconciliation are managed by CifraMais.
export function CompanyFinancialView(): ReactNode {
  const api = useApiClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useMemo(
    () => readQuery(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const [profile, setProfile] = useState<CompanyFinancialProfile | null>(null);
  const [receipts, setReceipts] = useState<CompanyReceipts | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(query.search);
  const listRequest = useRef<AbortController | null>(null);

  const hasFilters = Boolean(
    query.search || query.situation || query.billingType || query.period !== DEFAULT_PERIOD,
  );

  const updateQuery = useCallback(
    (patch: Partial<ReceiptsQuery>): void => {
      // Any filter change starts again from the first page.
      const next = { ...query, page: 1, ...patch };
      router.replace(`${pathname}${writeQuery(next)}`, { scroll: false });
    },
    [pathname, query, router],
  );

  function clearFilters(): void {
    setSearchInput("");
    updateQuery({
      search: "",
      situation: "",
      billingType: "",
      period: DEFAULT_PERIOD,
      startDate: "",
      endDate: "",
    });
  }

  // The search reaches the URL (and the API) once the user stops typing.
  useEffect(() => {
    if (searchInput.trim() === query.search) return;
    const timer = window.setTimeout(() => updateQuery({ search: searchInput.trim() }), 350);
    return () => window.clearTimeout(timer);
  }, [query.search, searchInput, updateQuery]);

  // The account changes rarely: loaded once, not on every page or filter.
  useEffect(() => {
    let active = true;
    api
      .getFinancialProfile()
      .then((nextProfile) => {
        if (active) setProfile(nextProfile);
      })
      .catch(() => {
        // Without the profile the account card is hidden; receipts still show.
      });
    return () => {
      active = false;
    };
  }, [api]);

  const fetchReceipts = useCallback(async (): Promise<void> => {
    // A slower answer for a previous filter must not replace the current list.
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    setLoading(true);
    try {
      const result = await api.getCompanyReceipts(
        {
          page: query.page,
          pageSize: query.pageSize,
          search: query.search || undefined,
          situation: query.situation || undefined,
          billingType: query.billingType || undefined,
          period: query.period || undefined,
          startDate: query.startDate || undefined,
          endDate: query.endDate || undefined,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setReceipts(result);
      setListError(null);
    } catch {
      if (controller.signal.aborted) return;
      setListError("Não foi possível carregar os recebimentos.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [api, query]);

  useEffect(() => {
    void fetchReceipts();
  }, [fetchReceipts]);

  // A saved link or a shorter list can point past the last page.
  useEffect(() => {
    if (!receipts || loading) return;
    const lastPage = Math.max(1, Math.ceil(receipts.total / query.pageSize));
    if (query.page > lastPage) updateQuery({ page: lastPage });
  }, [loading, query.page, query.pageSize, receipts, updateQuery]);

  useEffect(() => () => listRequest.current?.abort(), []);

  const totals = receipts?.totals;
  const totalCards: [string, number][] = totals
    ? [
        ["Recebido", totals.receivedCents],
        ["Tarifa Efí", totals.efiFeeCents],
        ["Remuneração CifraMais", totals.platformFeeCents - totals.platformFeeReversalCents],
        ["Devolvido", totals.refundedCents],
        ["Líquido", totals.netCents],
      ]
    : [];

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Financeiro</h1>
          <p className="mt-1 text-sm text-slate-500">
            Recebimentos das cobranças pagas, com tarifa Efí e remuneração CifraMais.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchReceipts()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : undefined} />
          Atualizar
        </button>
      </header>

      {profile && (
        <section
          aria-label="Conta de recebimento"
          className="flex items-start gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm"
        >
          <Wallet size={18} className="mt-0.5 shrink-0 text-slate-400" />
          {profile.status === "ACTIVE" ? (
            <p className="text-slate-600">
              <span className="font-medium text-slate-900">Conta de recebimento: </span>
              {MODE_LABELS[profile.accountMode ?? ""] ?? profile.accountMode} · conta{" "}
              {profile.issuerAccount ?? "—"} · {profile.enabledMethods.map(billingMethodLabel).join(", ")} ·
              ativa desde {day(profile.activatedAt)}. Os pagamentos caem diretamente nesta conta; conta,
              credenciais e tarifas são gerenciadas pela equipe CifraMais.
            </p>
          ) : (
            <p className="text-amber-800">
              Ativação financeira pendente: a equipe CifraMais está configurando sua conta de recebimento.
            </p>
          )}
        </section>
      )}

      <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <div className="grid gap-3 border-b border-slate-200 p-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_12rem_11rem_12rem]">
          <label className="relative block md:col-span-2 xl:col-span-1">
            <span className="sr-only">Buscar recebimentos</span>
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar por cliente, CPF/CNPJ ou e-mail"
              className={`${fieldClass} pl-9`}
            />
          </label>
          <label>
            <span className="sr-only">Filtrar por situação</span>
            <select
              value={query.situation}
              onChange={(event) => updateQuery({ situation: event.target.value as ReceiptsQuery["situation"] })}
              className={fieldClass}
            >
              {SITUATION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Filtrar por forma de pagamento</span>
            <select
              value={query.billingType}
              onChange={(event) => updateQuery({ billingType: event.target.value as ReceiptsQuery["billingType"] })}
              className={fieldClass}
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

        {totals && !listError && (
          <dl
            aria-label="Totais"
            className={`grid grid-cols-2 gap-px border-b border-slate-200 bg-slate-200 lg:grid-cols-5 ${loading ? "opacity-60" : ""}`}
          >
            {totalCards.map(([label, value]) => (
              <div
                key={label}
                className={`bg-slate-50 px-4 py-3 ${label === "Líquido" ? "col-span-2 lg:col-span-1" : ""}`}
              >
                <dt className="text-xs font-medium text-slate-500">{label}</dt>
                <dd
                  className={`mt-0.5 text-lg font-semibold tabular-nums ${label === "Líquido" ? "text-emerald-700" : "text-slate-900"}`}
                >
                  {formatCents(value)}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {!receipts && loading ? (
          <div className="flex min-h-64 flex-col items-center justify-center text-slate-500">
            <Loader2 className="mb-3 animate-spin" size={30} />
            <p className="text-sm">Carregando recebimentos...</p>
          </div>
        ) : listError ? (
          <div role="alert" className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center">
            <AlertCircle size={28} className="text-rose-500" />
            <p className="text-sm text-slate-700">{listError}</p>
            <button
              type="button"
              onClick={() => void fetchReceipts()}
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Tentar de novo
            </button>
          </div>
        ) : receipts && receipts.data.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center">
            <SearchX size={28} className="text-slate-400" />
            {hasFilters ? (
              <>
                <p className="text-sm text-slate-600">Nenhum recebimento encontrado com estes filtros.</p>
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
                <p className="text-sm text-slate-600">Nenhum recebimento neste mês.</p>
                <button
                  type="button"
                  onClick={() => updateQuery({ period: "", startDate: "", endDate: "" })}
                  className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Ver todo o histórico
                </button>
              </>
            )}
          </div>
        ) : receipts ? (
          <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[960px] table-fixed text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">Cliente</th>
                    <th className="w-24 px-4 py-2.5">Forma</th>
                    <th className="w-40 px-4 py-2.5">Pago em</th>
                    <th className="w-32 px-4 py-2.5 text-right">Pago</th>
                    <th className="w-28 px-4 py-2.5 text-right">Tarifa Efí</th>
                    <th className="w-32 px-4 py-2.5 text-right">Remuneração</th>
                    <th className="w-32 px-4 py-2.5 text-right">Líquido</th>
                    <th className="w-40 px-4 py-2.5">Situação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {receipts.data.map((row) => (
                    <tr key={row.invoiceId}>
                      <td className="px-4 py-2.5">
                        <p className="truncate font-medium text-slate-900">{row.debtorName}</p>
                        <p className="truncate text-xs text-slate-500">{formatDebtorDocument(row.debtorDocument)}</p>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{billingMethodLabel(row.billingMethod)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-slate-600">{formatDateTime(row.paidAt)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{formatCents(row.paidAmountCents)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                        {formatCents(row.efiFeeCents)}
                        {row.efiFeeEstimated && <span className="block text-xs text-slate-400">estimada</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{formatCents(row.platformFeeCents)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900">{formatCents(row.netCents)}</td>
                      <td className="px-4 py-2.5">
                        <SituationBadge row={row} />
                        {row.refundedCents > 0 && (
                          <span className="block text-xs text-rose-600">−{formatCents(row.refundedCents)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-slate-100 lg:hidden">
              {receipts.data.map((row) => (
                <li key={row.invoiceId} className="space-y-1.5 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{row.debtorName}</p>
                      <p className="truncate text-xs text-slate-500">{formatDebtorDocument(row.debtorDocument)}</p>
                    </div>
                    <p className="shrink-0 font-semibold tabular-nums text-slate-900">{formatCents(row.netCents)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                    <span>{billingMethodLabel(row.billingMethod)}</span>
                    <span aria-hidden>·</span>
                    <span>{formatDateTime(row.paidAt)}</span>
                    <SituationBadge row={row} />
                  </div>
                  <p className="text-xs text-slate-500">
                    Pago {formatCents(row.paidAmountCents)} · Tarifa Efí {formatCents(row.efiFeeCents)}
                    {row.efiFeeEstimated && " (estimada)"} · CifraMais {formatCents(row.platformFeeCents)}
                    {row.refundedCents > 0 && ` · Devolvido ${formatCents(row.refundedCents)}`}
                  </p>
                </li>
              ))}
            </ul>

            <TablePagination
              page={query.page}
              pageSize={query.pageSize}
              total={receipts.total}
              pageSizeLabel="Recebimentos por página"
              onChange={(next) => updateQuery(next)}
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
