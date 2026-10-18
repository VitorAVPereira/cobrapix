"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CompanyDashboard } from "@/lib/api-client";

// Brand palette (globals.css): petrol #154943 and green #0ac700.
const GREEN = "#0ac700";
const PETROL = "#154943";
const OVERDUE = "#e11d48";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatCompactBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/** "2026-10-17" → "17/10"; "2026-10" → "out/26". */
function bucketLabel(bucket: string): string {
  if (bucket.length === 7) {
    return `${MONTHS[Number(bucket.slice(5, 7)) - 1]}/${bucket.slice(2, 4)}`;
  }
  return `${bucket.slice(8, 10)}/${bucket.slice(5, 7)}`;
}

export function Panel({
  title,
  subtitle,
  className = "",
  children,
}: {
  title: string;
  subtitle?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={`flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}
    >
      <header className="mb-4">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex flex-1 items-center justify-center py-10 text-center text-sm text-slate-400">
      {children}
    </p>
  );
}

export function ReceivedChart({ data }: { data: CompanyDashboard }) {
  const series = data.receivedSeries.map((point) => ({
    ...point,
    label: bucketLabel(point.date),
  }));
  if (series.every((point) => point.amount === 0)) {
    return <Empty>Nenhum recebimento no período.</Empty>;
  }
  const best = series.reduce((top, point) => (point.amount > top.amount ? point : top));
  return (
    <div
      role="img"
      aria-label={`Recebimentos por ${data.period.granularity === "day" ? "dia" : "mês"}. Maior valor: ${formatBRL(best.amount)} em ${best.label}.`}
      className="h-64 w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="#edf4ef" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#566f64", fontSize: 12 }}
            minTickGap={12}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={72}
            tick={{ fill: "#566f64", fontSize: 12 }}
            tickFormatter={(value: number) => formatCompactBRL(value)}
          />
          <Tooltip
            cursor={{ fill: "#edf4ef" }}
            formatter={(value) => [formatBRL(Number(value)), "Recebido"]}
            contentStyle={{ borderRadius: 8, borderColor: "#dce9e1", fontSize: 13 }}
          />
          <Bar dataKey="amount" fill={GREEN} radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PortfolioChart({ data }: { data: CompanyDashboard }) {
  const { open } = data;
  if (open.count === 0) return <Empty>Nenhuma fatura em aberto.</Empty>;
  const slices = [
    { name: "A vencer", amount: open.upcomingAmount, count: open.upcomingCount, color: PETROL },
    { name: "Vencidas", amount: open.overdueAmount, count: open.overdueCount, color: OVERDUE },
  ];
  return (
    <div className="flex flex-1 flex-col items-center gap-4">
      <div
        role="img"
        aria-label={`Em aberto: ${formatBRL(open.upcomingAmount)} a vencer e ${formatBRL(open.overdueAmount)} vencidas.`}
        className="relative h-44 w-44"
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="amount"
              nameKey="name"
              innerRadius="68%"
              outerRadius="100%"
              paddingAngle={slices.every((slice) => slice.amount > 0) ? 2 : 0}
              stroke="none"
            >
              {slices.map((slice) => (
                <Cell key={slice.name} fill={slice.color} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => formatBRL(Number(value))} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs text-slate-500">Total</span>
          <span className="text-sm font-semibold text-slate-900">{formatBRL(open.amount)}</span>
        </div>
      </div>
      <ul className="w-full space-y-2 text-sm">
        {slices.map((slice) => (
          <li key={slice.name} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-slate-600">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: slice.color }} />
              {slice.name}
              <span className="text-xs text-slate-400">
                {slice.count.toLocaleString("pt-BR")} {slice.count === 1 ? "fatura" : "faturas"}
              </span>
            </span>
            <span className="font-medium text-slate-900">{formatBRL(slice.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BarList({
  rows,
  empty,
}: {
  rows: { label: string; amount: number; count: number; color: string }[];
  empty: string;
}) {
  const max = Math.max(...rows.map((row) => row.amount));
  if (max === 0) return <Empty>{empty}</Empty>;
  return (
    <ul className="space-y-4">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
            <span className="text-slate-600">
              {row.label}
              <span className="ml-2 text-xs text-slate-400">
                {row.count.toLocaleString("pt-BR")} {row.count === 1 ? "fatura" : "faturas"}
              </span>
            </span>
            <span className="font-medium text-slate-900">{formatBRL(row.amount)}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div
              className="h-2 rounded-full"
              style={{ width: `${(row.amount / max) * 100}%`, background: row.color }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

const AGING_LABELS: Record<CompanyDashboard["overdueAging"][number]["range"], string> = {
  "1-15": "1 a 15 dias",
  "16-30": "16 a 30 dias",
  "31-60": "31 a 60 dias",
  "60+": "Mais de 60 dias",
};
// Later is darker: the older the debt, the more it needs attention.
const AGING_COLORS = ["#fda4af", "#fb7185", "#e11d48", "#9f1239"];

export function AgingChart({ data }: { data: CompanyDashboard }) {
  return (
    <BarList
      empty="Nenhuma fatura vencida."
      rows={data.overdueAging.map((row, index) => ({
        label: AGING_LABELS[row.range],
        amount: row.amount,
        count: row.count,
        color: AGING_COLORS[index] ?? OVERDUE,
      }))}
    />
  );
}

const METHODS: Record<
  CompanyDashboard["receivedByMethod"][number]["method"],
  { label: string; color: string }
> = {
  PIX: { label: "Pix", color: GREEN },
  BOLETO: { label: "Boleto", color: PETROL },
  CARD: { label: "Cartão", color: "#8ca99b" },
};

export function MethodsChart({ data }: { data: CompanyDashboard }) {
  return (
    <BarList
      empty="Nenhum recebimento no período."
      rows={data.receivedByMethod.map((row) => ({
        label: METHODS[row.method].label,
        amount: row.amount,
        count: row.count,
        color: METHODS[row.method].color,
      }))}
    />
  );
}
