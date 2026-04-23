"use client";

import { useState } from "react";
import {
  Activity,
  ArrowUpRight,
  CircleDollarSign,
  Percent,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

type Period = "Hoje" | "7 Dias" | "30 Dias" | "Este Ano";

interface DashboardMetrics {
  activeCharges: number;
  pendingAmount: number;
  recoveredAmount: number;
  recoveryRate: number;
}

interface MetricCard {
  label: string;
  value: string;
  helper: string;
  icon: LucideIcon;
  emphasis?: "emerald";
}

const periods: Period[] = ["Hoje", "7 Dias", "30 Dias", "Este Ano"];

const mockMetricsByPeriod: Record<Period, DashboardMetrics> = {
  Hoje: {
    activeCharges: 18,
    pendingAmount: 8420.5,
    recoveredAmount: 2140.9,
    recoveryRate: 25.4,
  },
  "7 Dias": {
    activeCharges: 74,
    pendingAmount: 32890.75,
    recoveredAmount: 11850.25,
    recoveryRate: 36.0,
  },
  "30 Dias": {
    activeCharges: 213,
    pendingAmount: 92640.0,
    recoveredAmount: 48720.45,
    recoveryRate: 52.6,
  },
  "Este Ano": {
    activeCharges: 1248,
    pendingAmount: 418900.3,
    recoveredAmount: 286450.1,
    recoveryRate: 68.4,
  },
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
  const [selectedPeriod, setSelectedPeriod] = useState<Period>("30 Dias");
  const metrics = mockMetricsByPeriod[selectedPeriod];

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

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
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
                  {isEmerald && (
                    <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                      ROI
                    </span>
                  )}
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
                Performance do período
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                O painel usa dados demonstrativos até a API de analytics entrar
                em produção.
              </p>
            </div>
            <div className="rounded-md bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
              {selectedPeriod}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
