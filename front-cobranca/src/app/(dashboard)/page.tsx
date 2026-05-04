"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  CircleDollarSign,
  Loader2,
  MessageCircle,
  Percent,
  Send,
  Smartphone,
  TrendingDown,
  TrendingUp,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import type { BillingMetrics, DashboardPeriod, WhatsAppUsageResponse } from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";

type Period = "Hoje" | "7 Dias" | "30 Dias" | "Este Ano";

interface MetricCard {
  label: string;
  value: string;
  helper: string;
  icon: LucideIcon;
  emphasis?: "emerald";
}

const periods: Period[] = ["Hoje", "7 Dias", "30 Dias", "Este Ano"];

const periodToApiPeriod: Record<Period, DashboardPeriod> = {
  Hoje: "today",
  "7 Dias": "7d",
  "30 Dias": "30d",
  "Este Ano": "year",
};

const emptyMetrics: BillingMetrics = {
  period: "30d",
  activeCharges: 0,
  pendingAmount: 0,
  recoveredAmount: 0,
  recoveryRate: 0,
  paidCharges: 0,
  overdueCharges: 0,
  generatedPayments: 0,
  queuedMessages: 0,
  sentMessages: 0,
};

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatPercent(value: number): string {
  return `${value.toFixed(1).replace(".", ",")}%`;
}

export default function DashboardPage() {
  const apiClient = useApiClient();
  const [selectedPeriod, setSelectedPeriod] = useState<Period>("30 Dias");
  const [metrics, setMetrics] = useState<BillingMetrics>(emptyMetrics);
  const [usage, setUsage] = useState<WhatsAppUsageResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    async function fetchMetrics(): Promise<void> {
      setIsLoading(true);
      setErrorMsg(null);

      try {
        const data = await apiClient.getBillingMetrics(
          periodToApiPeriod[selectedPeriod],
        );
        setMetrics(data);
      } catch (error: unknown) {
        setErrorMsg(
          error instanceof Error
            ? error.message
            : "Nao foi possivel carregar as metricas.",
        );
      } finally {
        setIsLoading(false);
      }
    }

    void fetchMetrics();
  }, [apiClient, selectedPeriod]);

  useEffect(() => {
    async function fetchUsage(): Promise<void> {
      try {
        const data = await apiClient.getWhatsappUsage();
        setUsage(data);
      } catch {
        // consumo nao critico - nao mostra erro
      }
    }

    void fetchUsage();
  }, [apiClient]);

  const cards: MetricCard[] = [
    {
      label: "Cobranças Ativas",
      value: metrics.activeCharges.toLocaleString("pt-BR"),
      helper: "Faturas em acompanhamento",
      icon: WalletCards,
    },
    {
      label: "Total Pendente",
      value: formatBRL(metrics.pendingAmount),
      helper: "Valor ainda em aberto",
      icon: CircleDollarSign,
    },
    {
      label: "Total Recuperado",
      value: formatBRL(metrics.recoveredAmount),
      helper: "Receita recuperada pelo CobraPix",
      icon: ArrowUpRight,
      emphasis: "emerald",
    },
    {
      label: "Taxa de Recuperação",
      value: formatPercent(metrics.recoveryRate),
      helper: "Conversão sobre cobranças ativas",
      icon: Percent,
    },
    {
      label: "Pagas no Período",
      value: metrics.paidCharges.toLocaleString("pt-BR"),
      helper: "Confirmadas por webhook Efí",
      icon: CircleDollarSign,
      emphasis: "emerald",
    },
    {
      label: "Mensagens Enviadas",
      value: metrics.sentMessages.toLocaleString("pt-BR"),
      helper: "Disparos confirmados pela fila",
      icon: Send,
    },
    {
      label: "Pagamentos Gerados",
      value: metrics.generatedPayments.toLocaleString("pt-BR"),
      helper: "PIX, boleto ou Bolix preparados",
      icon: MessageCircle,
    },
    {
      label: "Vencidas em Aberto",
      value: metrics.overdueCharges.toLocaleString("pt-BR"),
      helper: "Faturas pendentes após vencimento",
      icon: AlertCircle,
    },
  ];

  return (
    <main className="min-h-full bg-slate-50">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
              <Activity size={14} />
              Cockpit Analítico
            </div>
            <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
              Visão financeira das cobranças
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Acompanhe o volume ativo, o caixa pendente e o retorno recuperado
              no período selecionado.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-md border border-slate-200 bg-white p-1 sm:flex">
            {periods.map((period) => {
              const isActive = selectedPeriod === period;

              return (
                <button
                  key={period}
                  type="button"
                  onClick={() => setSelectedPeriod(period)}
                  className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                    isActive
                      ? "bg-slate-900 text-white"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  {period}
                </button>
              );
            })}
          </div>
        </header>

        {errorMsg && (
          <div className="flex items-start gap-3 rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 shrink-0" size={18} />
            <span>{errorMsg}</span>
          </div>
        )}

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => {
            const Icon = card.icon;
            const isEmerald = card.emphasis === "emerald";

            return (
              <article
                key={card.label}
                className={`rounded-md border bg-white p-5 ${
                  isEmerald
                    ? "border-emerald-200 shadow-sm shadow-emerald-100"
                    : "border-slate-200"
                }`}
              >
                <div className="mb-5 flex items-start justify-between gap-3">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-md ${
                      isEmerald
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    <Icon size={20} />
                  </div>
                  {isLoading ? (
                    <Loader2 className="animate-spin text-slate-400" size={17} />
                  ) : isEmerald ? (
                    <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                      ROI
                    </span>
                  ) : null}
                </div>

                <p className="text-sm font-medium text-slate-500">
                  {card.label}
                </p>
                <strong
                  className={`mt-2 block text-2xl font-bold tracking-tight ${
                    isEmerald ? "text-emerald-700" : "text-slate-900"
                  }`}
                >
                  {card.value}
                </strong>
                <p className="mt-2 text-sm text-slate-500">{card.helper}</p>
              </article>
            );
          })}
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold text-slate-900">
                Performance do periodo
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Metricas alimentadas por faturas, logs da fila e webhooks da
                Efi no periodo selecionado.
              </p>
            </div>
            <div className="rounded-md bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
              {selectedPeriod}
            </div>
          </div>
        </section>

        {usage && (
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <article className="rounded-md border border-slate-200 bg-white p-5">
              <div className="mb-4 flex items-center gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-50 text-blue-600">
                  <Smartphone size={20} />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-500">
                    Limite Diario WhatsApp
                  </p>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                    {usage.tier.replace("TIER_", "Tier ")}
                  </span>
                </div>
              </div>

              <div className="mb-3">
                <div className="flex items-baseline justify-between">
                  <strong className="block text-2xl font-bold tracking-tight text-slate-900">
                    {usage.dailyUsage.toLocaleString("pt-BR")}
                  </strong>
                  <span className="text-sm text-slate-400">
                    / {usage.dailyLimit.toLocaleString("pt-BR")}
                  </span>
                </div>
                <p className="text-sm text-slate-500">clientes unicos hoje</p>
              </div>

              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full transition-all ${
                    usage.remaining === 0
                      ? "bg-rose-500"
                      : usage.dailyUsage / usage.dailyLimit > 0.8
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                  }`}
                  style={{
                    width: `${Math.min(
                      100,
                      (usage.dailyUsage / usage.dailyLimit) * 100,
                    )}%`,
                  }}
                />
              </div>
              <p className="mt-2 text-xs text-slate-400">
                {usage.remaining > 0
                  ? `${usage.remaining} envios restantes hoje`
                  : "Limite diario esgotado"}
              </p>
            </article>

            <article className="rounded-md border border-slate-200 bg-white p-5">
              <div className="mb-4 flex items-center gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-600">
                  <Send size={20} />
                </div>
                <p className="text-sm font-medium text-slate-500">
                  Envios Hoje
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-2xl font-bold text-slate-900">
                    {usage.interactions.outbound.toLocaleString("pt-BR")}
                  </span>
                  <p className="text-xs text-slate-400">enviados</p>
                </div>
                <div>
                  <span className="text-2xl font-bold text-emerald-700">
                    {usage.interactions.delivered.toLocaleString("pt-BR")}
                  </span>
                  <p className="text-xs text-slate-400">entregues</p>
                </div>
                <div>
                  <span className="text-2xl font-bold text-blue-700">
                    {usage.interactions.read.toLocaleString("pt-BR")}
                  </span>
                  <p className="text-xs text-slate-400">lidos</p>
                </div>
                <div>
                  <span className="text-2xl font-bold text-rose-700">
                    {usage.interactions.failed.toLocaleString("pt-BR")}
                  </span>
                  <p className="text-xs text-slate-400">falhas</p>
                </div>
              </div>
            </article>

            <article className="rounded-md border border-slate-200 bg-white p-5">
              <div className="mb-4 flex items-center gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-violet-50 text-violet-600">
                  {usage.interactions.inbound > 0 ? (
                    <TrendingUp size={20} />
                  ) : (
                    <TrendingDown size={20} />
                  )}
                </div>
                <p className="text-sm font-medium text-slate-500">
                  Interacoes Hoje
                </p>
              </div>

              <span className="text-2xl font-bold text-violet-700">
                {usage.interactions.inbound.toLocaleString("pt-BR")}
              </span>
              <p className="text-sm text-slate-500">
                respostas de clientes
              </p>

              <div className="mt-4 rounded-md bg-slate-50 p-3">
                <p className="text-xs leading-relaxed text-slate-500">
                  Clientes que respondem as mensagens ajudam a melhorar a
                  qualidade do seu numero e podem aumentar seu limite de envios
                  na Meta.
                </p>
              </div>
            </article>
          </section>
        )}
      </div>
    </main>
  );
}
