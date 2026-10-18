"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  CircleDollarSign,
  Clock,
  Mail,
  MessageCircle,
  Percent,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import type { CompanyDashboard } from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";
import { PeriodFilter, type DashboardQuery } from "@/components/features/dashboard/PeriodFilter";
import {
  AgingChart,
  MethodsChart,
  Panel,
  PortfolioChart,
  ReceivedChart,
  formatBRL,
} from "@/components/features/dashboard/DashboardCharts";

function formatDate(date: string, withYear = true): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "short",
    year: withYear ? "numeric" : undefined,
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

/** "19 de set. a 18 de out. de 2026": the year once when both dates share it. */
function formatRange(start: string, end: string): string {
  if (start === end) return formatDate(start);
  return `${formatDate(start, start.slice(0, 4) !== end.slice(0, 4))} a ${formatDate(end)}`;
}

function formatPercent(value: number): string {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("pt-BR")} ${count === 1 ? one : many}`;
}

/** Only an improvement is highlighted; the previous rate reads clearer than points. */
function rateImprovement(current: number | null, previous: number | null): string | null {
  if (current === null || previous === null || current - previous < 0.05) return null;
  return `antes: ${formatPercent(previous)}`;
}

function KpiCard({
  label,
  value,
  detail,
  icon: Icon,
  improvement,
  tone = "default",
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  improvement?: string | null;
  tone?: "default" | "positive" | "danger";
}) {
  const iconTone = {
    default: "bg-slate-100 text-slate-700",
    positive: "bg-emerald-50 text-emerald-500",
    danger: "bg-rose-50 text-rose-600",
  }[tone];
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconTone}`}>
          <Icon size={18} aria-hidden="true" />
        </span>
      </div>
      <strong className="mt-3 block text-2xl font-semibold tracking-tight text-slate-900">
        {value}
      </strong>
      <p className="mt-1 text-sm text-slate-500">{detail}</p>
      {improvement && (
        <p className="mt-3 inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-500">
          <ArrowUpRight size={13} aria-hidden="true" />
          {improvement}
        </p>
      )}
    </article>
  );
}

function ChannelStats({
  icon: Icon,
  title,
  stats,
}: {
  icon: LucideIcon;
  title: string;
  stats: { label: string; value: number; tone?: "danger" }[];
}) {
  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-600">
        <Icon size={16} aria-hidden="true" />
        {title}
      </h3>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg bg-slate-50 px-3 py-2.5">
            <dt className="text-xs text-slate-500">{stat.label}</dt>
            <dd
              className={`mt-0.5 text-lg font-semibold ${
                stat.tone === "danger" && stat.value > 0 ? "text-rose-600" : "text-slate-900"
              }`}
            >
              {stat.value.toLocaleString("pt-BR")}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-hidden="true" className="flex animate-pulse flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className="h-36 rounded-xl bg-slate-100" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="h-80 rounded-xl bg-slate-100 xl:col-span-2" />
        <div className="h-80 rounded-xl bg-slate-100" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const apiClient = useApiClient();
  const [query, setQuery] = useState<DashboardQuery>({ period: "30d" });
  const [data, setData] = useState<CompanyDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  function load(change: () => void): void {
    setIsLoading(true);
    setError(null);
    change();
  }

  useEffect(() => {
    // A slower answer for a previous period must not replace the current one.
    const controller = new AbortController();
    apiClient
      .getCompanyDashboard(query, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        // An attempt made before the session loaded may have failed.
        setError(null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Não foi possível carregar o painel.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [apiClient, query, reload]);

  const period = data?.period;

  return (
    <main className="min-h-full bg-slate-50">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              Visão geral
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {period
                ? formatRange(period.startDate, period.endDate)
                : "Carregando período…"}
            </p>
          </div>
          <PeriodFilter value={query} onChange={(next) => load(() => setQuery(next))} />
        </header>

        {error && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
          >
            <AlertCircle className="shrink-0" size={18} aria-hidden="true" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => load(() => setReload((count) => count + 1))}
              className="rounded-md border border-rose-200 bg-white px-3 py-1.5 font-medium hover:bg-rose-100"
            >
              Tentar de novo
            </button>
          </div>
        )}

        {!data && isLoading && <Skeleton />}

        {data && (
          <div
            aria-busy={isLoading}
            className={`flex flex-col gap-6 transition-opacity ${isLoading ? "opacity-60" : ""}`}
          >
            <section aria-label="Indicadores" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                label="Recebido"
                value={formatBRL(data.received.amount)}
                detail={plural(data.received.count, "fatura paga", "faturas pagas")}
                icon={CircleDollarSign}
                tone="positive"
              />
              <KpiCard
                label="Taxa de recebimento"
                value={
                  data.collectionRate.rate === null ? "—" : formatPercent(data.collectionRate.rate)
                }
                detail={
                  data.collectionRate.rate === null
                    ? "Nenhuma fatura venceu no período"
                    : `${formatBRL(data.collectionRate.paidAmount)} de ${formatBRL(data.collectionRate.dueAmount)} que venceram`
                }
                icon={Percent}
                improvement={rateImprovement(data.collectionRate.rate, data.collectionRate.previousRate)}
              />
              <KpiCard
                label="Em aberto"
                value={formatBRL(data.open.amount)}
                detail={`${plural(data.open.count, "fatura", "faturas")} hoje`}
                icon={WalletCards}
              />
              <KpiCard
                label="Vencidas"
                value={formatBRL(data.open.overdueAmount)}
                detail={`${plural(data.open.overdueCount, "fatura", "faturas")} hoje`}
                icon={Clock}
                tone={data.open.overdueCount > 0 ? "danger" : "default"}
              />
            </section>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <Panel
                title={data.period.granularity === "day" ? "Recebimentos por dia" : "Recebimentos por mês"}
                subtitle="Valor das faturas pagas"
                className="xl:col-span-2"
              >
                <ReceivedChart data={data} />
              </Panel>
              <Panel title="Carteira em aberto" subtitle="Situação de hoje">
                <PortfolioChart data={data} />
              </Panel>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Panel title="Vencidas por atraso" subtitle="Situação de hoje">
                <AgingChart data={data} />
              </Panel>
              <Panel title="Recebido por forma de pagamento" subtitle="No período">
                <MethodsChart data={data} />
              </Panel>
            </div>

            <Panel title="Comunicação" subtitle="Mensagens de cobrança no período">
              <div className="flex flex-col gap-6">
                <ChannelStats
                  icon={MessageCircle}
                  title="WhatsApp"
                  stats={[
                    { label: "Enviadas", value: data.whatsapp.sent },
                    { label: "Entregues", value: data.whatsapp.delivered },
                    { label: "Lidas", value: data.whatsapp.read },
                    { label: "Respostas", value: data.whatsapp.replies },
                    { label: "Falhas", value: data.whatsapp.failed, tone: "danger" },
                  ]}
                />
                <ChannelStats
                  icon={Mail}
                  title="E-mail"
                  stats={[
                    { label: "Enviados", value: data.email.sent },
                    { label: "Entregues", value: data.email.delivered },
                    { label: "Abertos", value: data.email.opened },
                    { label: "Cliques", value: data.email.clicked },
                  ]}
                />
              </div>
            </Panel>
          </div>
        )}
      </div>
    </main>
  );
}
