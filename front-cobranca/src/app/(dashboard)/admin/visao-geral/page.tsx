"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import {
  AlertCircle,
  BarChart3,
  CircleDollarSign,
  Loader2,
  Mail,
  MessageCircle,
  Search,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import type {
  AdminAnalyticsPeriod,
  AdminClientAnalyticsMetrics,
  AdminClientAnalyticsParams,
  AdminClientAnalyticsResponse,
} from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";

const periodOptions: Array<{ label: string; value: AdminAnalyticsPeriod }> = [
  { label: "Mes atual", value: "current_month" },
  { label: "Hoje", value: "today" },
  { label: "7 dias", value: "7d" },
  { label: "30 dias", value: "30d" },
  { label: "Ano", value: "year" },
  { label: "Personalizado", value: "custom" },
];

const emptyMetrics: AdminClientAnalyticsMetrics = {
  totalChargedAmount: 0,
  activeChargesCount: 0,
  overduePendingChargesCount: 0,
  canceledChargesCount: 0,
  pendingTotalAmount: 0,
  overduePendingAmount: 0,
  whatsappSentCount: 0,
  whatsappCostAmount: 0,
  emailSentCount: 0,
  emailCostAmount: 0,
  averageTicketAmount: 0,
  recoveredChargesCount: 0,
  recoveredAmount: 0,
};

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatCount(value: number): string {
  return value.toLocaleString("pt-BR");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Nao foi possivel carregar a visao geral.";
}

function getCustomDateError(
  period: AdminAnalyticsPeriod,
  startDate: string,
  endDate: string,
): string | null {
  if (period !== "custom") {
    return null;
  }

  if (!startDate || !endDate) {
    return "Informe a data inicial e final para carregar o periodo personalizado.";
  }

  if (startDate > endDate) {
    return "A data inicial deve ser menor ou igual a data final.";
  }

  return null;
}

function buildAnalyticsParams(
  period: AdminAnalyticsPeriod,
  search: string,
  startDate: string,
  endDate: string,
): AdminClientAnalyticsParams | null {
  const customDateError = getCustomDateError(period, startDate, endDate);

  if (customDateError) {
    return null;
  }

  if (period !== "custom") {
    return { period, search };
  }

  return {
    period,
    search,
    startDate,
    endDate,
  };
}

export default function AdminOverviewPage() {
  const apiClient = useApiClient();
  const { data: session } = useSession();
  const [period, setPeriod] = useState<AdminAnalyticsPeriod>("current_month");
  const [search, setSearch] = useState("");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [analytics, setAnalytics] =
    useState<AdminClientAnalyticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isPlatformAdmin = session?.user.role === "PLATFORM_ADMIN";
  const customDateError = getCustomDateError(
    period,
    customStartDate,
    customEndDate,
  );

  const loadAnalytics = useCallback(async (): Promise<void> => {
    if (!isPlatformAdmin) {
      setIsLoading(false);
      return;
    }

    const params = buildAnalyticsParams(
      period,
      search,
      customStartDate,
      customEndDate,
    );

    if (!params) {
      setIsLoading(false);
      setError(customDateError);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await apiClient.getAdminClientAnalytics(params);
      setAnalytics(data);
    } catch (loadError: unknown) {
      setError(getErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [
    apiClient,
    customDateError,
    customEndDate,
    customStartDate,
    isPlatformAdmin,
    period,
    search,
  ]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const totals = analytics?.totals ?? emptyMetrics;
  const cards = useMemo(
    () => [
      {
        label: "Valor cobrado",
        value: formatBRL(totals.totalChargedAmount),
        helper: "Cobrancas criadas no periodo",
        icon: CircleDollarSign,
      },
      {
        label: "Pendente total",
        value: formatBRL(totals.pendingTotalAmount),
        helper: "Dentro do prazo e vencidas",
        icon: WalletCards,
      },
      {
        label: "Vencido pendente",
        value: formatBRL(totals.overduePendingAmount),
        helper: `${formatCount(totals.overduePendingChargesCount)} cobrancas vencidas`,
        icon: AlertCircle,
      },
      {
        label: "Recuperado",
        value: formatBRL(totals.recoveredAmount),
        helper: `${formatCount(totals.recoveredChargesCount)} cobrancas recuperadas`,
        icon: TrendingUp,
      },
      {
        label: "Ticket medio",
        value: formatBRL(totals.averageTicketAmount),
        helper: "Pendente + pagas, sem canceladas",
        icon: BarChart3,
      },
      {
        label: "WhatsApp",
        value: formatBRL(totals.whatsappCostAmount),
        helper: `${formatCount(totals.whatsappSentCount)} envios`,
        icon: MessageCircle,
      },
      {
        label: "E-mails",
        value: formatCount(totals.emailSentCount),
        helper: "Custo R$ 0,00",
        icon: Mail,
      },
    ],
    [totals],
  );

  if (!isPlatformAdmin) {
    return (
      <main className="min-h-full bg-slate-50 p-4 lg:p-8">
        <div className="rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-700">
          Acesso restrito.
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-full bg-slate-50">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 lg:p-8">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Visao geral</h1>
            <p className="mt-1 text-sm text-slate-500">
              Indicadores financeiros e operacionais por cliente da plataforma.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-md border border-slate-200 bg-white p-1 sm:flex">
            {periodOptions.map((option) => {
              const active = period === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setPeriod(option.value)}
                  className={`rounded-md px-3 py-2 text-sm font-semibold transition ${
                    active
                      ? "bg-slate-900 text-white"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </header>

        <section className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-4 md:flex-row md:items-center">
          <label className="relative flex-1">
            <span className="sr-only">Buscar cliente</span>
            <Search
              size={17}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              aria-label="Buscar cliente"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar cliente por nome, email ou documento"
              className="h-10 w-full rounded-md border border-slate-200 pl-10 pr-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            />
          </label>
          {period === "custom" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-500">
                Data inicial
                <input
                  aria-label="Data inicial"
                  type="date"
                  value={customStartDate}
                  onChange={(event) => setCustomStartDate(event.target.value)}
                  className="h-10 rounded-md border border-slate-200 px-3 text-sm font-normal text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-500">
                Data final
                <input
                  aria-label="Data final"
                  type="date"
                  value={customEndDate}
                  onChange={(event) => setCustomEndDate(event.target.value)}
                  className="h-10 rounded-md border border-slate-200 px-3 text-sm font-normal text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                />
              </label>
            </div>
          )}
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" />
              Carregando
            </div>
          )}
        </section>

        {error && (
          <div className="flex items-start gap-3 rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 shrink-0" size={18} />
            <span>{error}</span>
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => {
            const Icon = card.icon;

            return (
              <article
                key={card.label}
                className="rounded-md border border-slate-200 bg-white p-5"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                  <Icon size={20} />
                </div>
                <p className="text-sm font-medium text-slate-500">
                  {card.label}
                </p>
                <strong className="mt-2 block text-2xl font-bold text-slate-900">
                  {card.value}
                </strong>
                <p className="mt-2 text-sm text-slate-500">{card.helper}</p>
              </article>
            );
          })}
        </section>

        <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900">
              Clientes no periodo
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Cobrado</th>
                  <th className="px-4 py-3">Pendente</th>
                  <th className="px-4 py-3">Vencido</th>
                  <th className="px-4 py-3">Ativas</th>
                  <th className="px-4 py-3">Canceladas</th>
                  <th className="px-4 py-3">Recuperado</th>
                  <th className="px-4 py-3">WhatsApp</th>
                  <th className="px-4 py-3">E-mails</th>
                  <th className="px-4 py-3">Ticket medio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!isLoading && analytics?.clients.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-6 text-slate-500">
                      Nenhum cliente encontrado no periodo.
                    </td>
                  </tr>
                ) : (
                  analytics?.clients.map((client) => (
                    <tr key={client.companyId} className="align-top">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900">
                          {client.corporateName}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {client.email}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        {formatBRL(client.metrics.totalChargedAmount)}
                      </td>
                      <td className="px-4 py-3">
                        {formatBRL(client.metrics.pendingTotalAmount)}
                      </td>
                      <td className="px-4 py-3">
                        {formatBRL(client.metrics.overduePendingAmount)}
                      </td>
                      <td className="px-4 py-3">
                        {formatCount(client.metrics.activeChargesCount)}
                      </td>
                      <td className="px-4 py-3">
                        {formatCount(client.metrics.canceledChargesCount)}
                      </td>
                      <td className="px-4 py-3">
                        {formatBRL(client.metrics.recoveredAmount)}
                      </td>
                      <td className="px-4 py-3">
                        <p>{formatCount(client.metrics.whatsappSentCount)}</p>
                        <p className="text-xs text-slate-500">
                          {formatBRL(client.metrics.whatsappCostAmount)}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        {formatCount(client.metrics.emailSentCount)}
                      </td>
                      <td className="px-4 py-3">
                        {formatBRL(client.metrics.averageTicketAmount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
