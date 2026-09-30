"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Copy, ExternalLink, FileText, RefreshCw } from "lucide-react";
import { BrandLogo } from "@/components/ui/BrandLogo";
import type { LoadedPayment, PublicPaymentData, PublicPaymentState } from "./load-payment";

export type { PublicPaymentData } from "./load-payment";

interface PaymentPageClientProps {
  payment: LoadedPayment;
}

type CopyTarget = "pix" | "boleto";

const METHOD_LABELS: Record<string, string> = {
  PIX: "Pix",
  BOLIX: "Boleto com Pix",
  BOLETO: "Boleto",
};

const STATE_VIEW: Record<
  PublicPaymentState,
  { title: string; badge: string; badgeClass: string; message?: (company: string) => string }
> = {
  PAYABLE: {
    title: "Pagamento de cobrança",
    badge: "Pendente",
    badgeClass: "bg-amber-50 text-amber-700",
  },
  PAID: {
    title: "Pagamento confirmado",
    badge: "Pago",
    badgeClass: "bg-emerald-50 text-emerald-700",
    message: () => "O pagamento desta cobrança foi confirmado. Não é necessário pagar novamente.",
  },
  CANCELED: {
    title: "Cobrança cancelada",
    badge: "Cancelada",
    badgeClass: "bg-slate-100 text-slate-700",
    message: (company) => `Esta cobrança foi cancelada. Em caso de dúvida, fale com ${company}.`,
  },
  EXPIRED: {
    title: "Prazo de pagamento encerrado",
    badge: "Encerrada",
    badgeClass: "bg-slate-100 text-slate-700",
    message: (company) =>
      `O prazo para pagar esta cobrança por este link terminou. Fale com ${company} para receber uma nova cobrança.`,
  },
  UNAVAILABLE: {
    title: "Pagamento indisponível no momento",
    badge: "Indisponível",
    badgeClass: "bg-slate-100 text-slate-700",
    message: (company) =>
      `Os dados para pagamento ainda não estão disponíveis. Tente atualizar mais tarde ou fale com ${company}.`,
  },
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

// The due date is a calendar date; reading it in UTC avoids showing the day before.
function formatDueDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(
    date,
  );
}

function formatInstant(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

// Only https links from the payment provider are opened.
function safeExternalUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center p-4 sm:p-6">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">{children}</section>
      </div>
    </main>
  );
}

function Notice({ title, message, onRefresh }: { title: string; message: string; onRefresh?: () => void }) {
  return (
    <Shell>
      <div className="px-5 py-6 sm:px-6">
        {/* The logo is not a link: nothing here leads to the product dashboard. */}
        <BrandLogo width={116} height={38} className="mb-6" priority />
        <h1 className="text-xl font-bold text-slate-950">{title}</h1>
        <p role="status" className="mt-3 text-sm leading-6 text-slate-600">
          {message}
        </p>
        {onRefresh && <RefreshButton onRefresh={onRefresh} />}
      </div>
    </Shell>
  );
}

function RefreshButton({ onRefresh }: { onRefresh: () => void }) {
  return (
    <button
      type="button"
      onClick={onRefresh}
      className="mt-4 inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
    >
      <RefreshCw size={16} />
      Atualizar situação
    </button>
  );
}

function CopyCode({
  label,
  value,
  copied,
  onCopy,
  tone,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  tone: "emerald" | "sky";
}) {
  const colors =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
      : "border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100";
  return (
    <div className={`rounded-md border px-4 py-3 ${colors}`}>
      <button type="button" onClick={onCopy} className="flex w-full items-center justify-between gap-3 text-left text-sm font-semibold">
        <span>{copied ? `${label}: copiado` : label}</span>
        {copied ? <CheckCircle2 size={18} /> : <Copy size={18} />}
      </button>
      {/* Shown whole, so it can also be selected by hand. */}
      <code className="mt-2 block select-all break-all font-mono text-xs font-medium text-slate-900">{value}</code>
    </div>
  );
}

function ExternalButton({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy="no-referrer"
      className="flex w-full items-center justify-between gap-3 rounded-md border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
    >
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      <span className="text-xs text-slate-400">nova aba</span>
    </a>
  );
}

function PaymentDetails({ data, onRefresh }: { data: PublicPaymentData; onRefresh: () => void }) {
  const [copied, setCopied] = useState<CopyTarget | null>(null);
  const [copyError, setCopyError] = useState(false);
  const view = STATE_VIEW[data.state];
  // Actions only when the backend confirmed payment is available.
  const payable = data.state === "PAYABLE" && data.canPay;
  const pix = payable ? data.pixCopyPaste : null;
  const boletoLine = payable ? data.boletoLine : null;
  const boletoLink = payable ? safeExternalUrl(data.boletoLink) : null;
  const boletoPdf = payable ? safeExternalUrl(data.boletoPdf) : null;
  const hasInstrument = Boolean(pix || boletoLine || boletoLink || boletoPdf);
  const message = payable
    ? hasInstrument
      ? null
      : STATE_VIEW.UNAVAILABLE.message?.(data.companyName)
    : view.message?.(data.companyName);

  async function copyValue(target: CopyTarget, value: string) {
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(target);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <Shell>
      <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
        <BrandLogo width={116} height={38} className="mb-5" priority />
        <p className="text-sm font-semibold text-emerald-700">{data.companyName}</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-950">{view.title}</h1>
        <p className="mt-2 text-sm text-slate-500">
          {data.debtorName} - vencimento em {formatDueDate(data.dueDate)}
        </p>
      </div>

      <div className="grid gap-4 px-5 py-5 sm:grid-cols-3 sm:px-6">
        <div>
          <p className="text-xs font-semibold uppercase text-slate-400">Valor</p>
          <p className="mt-1 text-lg font-bold text-slate-950">{formatCurrency(data.amount)}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-slate-400">Método</p>
          <p className="mt-1 text-lg font-bold text-slate-950">{METHOD_LABELS[data.billingType] ?? data.billingType}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-slate-400">Situação</p>
          <p className={`mt-1 inline-flex rounded px-2 py-1 text-sm font-semibold ${view.badgeClass}`}>{view.badge}</p>
        </div>
      </div>

      <div className="space-y-3 border-t border-slate-100 px-5 py-5 sm:px-6">
        {message && (
          <p role="status" className="text-sm leading-6 text-slate-600">
            {message}
            {data.state === "PAID" && data.paidAt ? ` Confirmado em ${formatInstant(data.paidAt)}.` : ""}
          </p>
        )}
        {pix && (
          <CopyCode
            label="Copiar Pix copia e cola"
            value={pix}
            copied={copied === "pix"}
            onCopy={() => void copyValue("pix", pix)}
            tone="emerald"
          />
        )}
        {boletoLine && (
          <CopyCode
            label="Copiar linha digitável"
            value={boletoLine}
            copied={copied === "boleto"}
            onCopy={() => void copyValue("boleto", boletoLine)}
            tone="sky"
          />
        )}
        {copyError && (
          <p role="alert" className="text-sm text-rose-700">
            Não foi possível copiar automaticamente. Selecione o código acima e copie manualmente.
          </p>
        )}
        {boletoLink && <ExternalButton href={boletoLink} icon={<ExternalLink size={17} />} label="Abrir boleto" />}
        {boletoPdf && <ExternalButton href={boletoPdf} icon={<FileText size={17} />} label="Abrir PDF" />}
        {(payable || data.state === "UNAVAILABLE") && <RefreshButton onRefresh={onRefresh} />}
        {payable && (
          <p className="text-xs text-slate-500">
            Depois de pagar, a confirmação pode levar alguns minutos para aparecer aqui.
          </p>
        )}
      </div>
    </Shell>
  );
}

export default function PaymentPageClient({ payment }: PaymentPageClientProps) {
  const router = useRouter();
  const refresh = () => router.refresh();

  // Coming back through the browser history must not show instruments kept in
  // the page cache: the state is read again from the server.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) router.refresh();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [router]);

  if (payment.kind === "invalid")
    return <Notice title="Link indisponível" message="Link de pagamento inválido ou expirado." />;
  if (payment.kind === "unavailable")
    return (
      <Notice
        title="Não foi possível carregar esta cobrança agora"
        message="Tente novamente em alguns instantes."
        onRefresh={refresh}
      />
    );
  return <PaymentDetails data={payment.data} onRefresh={refresh} />;
}
