"use client";

import { useState } from "react";
import { CheckCircle2, Copy, ExternalLink, FileText } from "lucide-react";
import type { BillingMethod } from "@/lib/api-client";

export interface PublicPaymentData {
  invoiceId: string;
  companyName: string;
  debtorName: string;
  amount: number;
  dueDate: string;
  billingType: BillingMethod;
  pixCopyPaste: string | null;
  boletoLine: string | null;
  boletoLink: string | null;
  boletoPdf: string | null;
  expiresAt: string | null;
}

interface PaymentPageClientProps {
  data: PublicPaymentData | null;
  error: string | null;
}

type CopyTarget = "pix" | "boleto" | null;

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export default function PaymentPageClient({
  data,
  error,
}: PaymentPageClientProps) {
  const [copied, setCopied] = useState<CopyTarget>(null);

  async function copyValue(target: Exclude<CopyTarget, null>, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(target);
    window.setTimeout(() => setCopied(null), 2000);
  }

  if (error || !data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <section className="w-full max-w-lg rounded-md border border-red-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-bold text-slate-950">
            Link indisponivel
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {error ?? "Nao foi possivel carregar esta cobranca."}
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center p-4 sm:p-6">
        <section className="rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
            <p className="text-sm font-semibold text-emerald-700">
              {data.companyName}
            </p>
            <h1 className="mt-1 text-2xl font-bold text-slate-950">
              Pagamento de cobranca
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              {data.debtorName} - vencimento em {formatDate(data.dueDate)}
            </p>
          </div>

          <div className="grid gap-4 px-5 py-5 sm:grid-cols-3 sm:px-6">
            <div>
              <p className="text-xs font-semibold uppercase text-slate-400">
                Valor
              </p>
              <p className="mt-1 text-lg font-bold text-slate-950">
                {formatCurrency(data.amount)}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-400">
                Metodo
              </p>
              <p className="mt-1 text-lg font-bold text-slate-950">
                {data.billingType}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-400">
                Status
              </p>
              <p className="mt-1 inline-flex rounded bg-amber-50 px-2 py-1 text-sm font-semibold text-amber-700">
                Pendente
              </p>
            </div>
          </div>

          <div className="space-y-3 border-t border-slate-100 px-5 py-5 sm:px-6">
            {data.pixCopyPaste && (
              <button
                type="button"
                onClick={() => void copyValue("pix", data.pixCopyPaste ?? "")}
                className="flex w-full items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-left text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100"
              >
                <span className="min-w-0">
                  <span className="block">Copiar Pix copia e cola</span>
                  <span className="mt-1 block truncate font-mono text-xs font-medium text-emerald-950">
                    {data.pixCopyPaste}
                  </span>
                </span>
                {copied === "pix" ? (
                  <CheckCircle2 size={18} />
                ) : (
                  <Copy size={18} />
                )}
              </button>
            )}

            {data.boletoLine && (
              <button
                type="button"
                onClick={() => void copyValue("boleto", data.boletoLine ?? "")}
                className="flex w-full items-center justify-between gap-3 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-left text-sm font-semibold text-sky-800 transition hover:bg-sky-100"
              >
                <span className="min-w-0">
                  <span className="block">Copiar linha digitavel</span>
                  <span className="mt-1 block truncate font-mono text-xs font-medium text-sky-950">
                    {data.boletoLine}
                  </span>
                </span>
                {copied === "boleto" ? (
                  <CheckCircle2 size={18} />
                ) : (
                  <Copy size={18} />
                )}
              </button>
            )}

            {data.boletoLink && (
              <a
                href={data.boletoLink}
                target="_blank"
                rel="noreferrer"
                className="flex w-full items-center justify-between gap-3 rounded-md border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <span className="flex items-center gap-2">
                  <ExternalLink size={17} />
                  Abrir boleto
                </span>
                <span className="text-xs text-slate-400">nova aba</span>
              </a>
            )}

            {data.boletoPdf && (
              <a
                href={data.boletoPdf}
                target="_blank"
                rel="noreferrer"
                className="flex w-full items-center justify-between gap-3 rounded-md border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <span className="flex items-center gap-2">
                  <FileText size={17} />
                  Abrir PDF
                </span>
                <span className="text-xs text-slate-400">nova aba</span>
              </a>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
