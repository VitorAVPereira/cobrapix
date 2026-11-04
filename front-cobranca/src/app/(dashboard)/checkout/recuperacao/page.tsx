"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Copy, Download, Loader2, MessageCircle, RotateCcw } from "lucide-react";
import type {
  CheckoutProduct,
  CheckoutRecoveryItem,
  CheckoutRecoveryKind,
  CheckoutRecoveryPage,
} from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";
import { formatCents, formatDateTime } from "@/lib/disbursements";
import { recoveryWhatsAppLink } from "@/lib/checkout";
import { inputClass, messageOf, NoticeText, secondaryButtonClass, type Notice } from "@/components/features/checkout/ui";

const PERIODS = [
  { value: "30", label: "Últimos 30 dias" },
  { value: "90", label: "Últimos 90 dias" },
  { value: "all", label: "Todo o período" },
] as const;
const PAGE_SIZE = 20;

// "All" is sent explicitly: with no date the API shows the last 30 days.
function since(days: string): string {
  if (days === "all") return new Date(0).toISOString();
  return new Date(Date.now() - Number(days) * 86_400_000).toISOString();
}

function contactText(item: CheckoutRecoveryItem): string {
  return [item.name, item.email, item.phone].filter(Boolean).join(" · ");
}

export default function CheckoutRecoveryPage() {
  const api = useApiClient();
  const [kind, setKind] = useState<CheckoutRecoveryKind | "">("");
  const [productId, setProductId] = useState("");
  const [period, setPeriod] = useState<string>("30");
  const [state, setState] = useState<"OPEN" | "RECOVERED">("OPEN");
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [products, setProducts] = useState<CheckoutProduct[]>([]);
  const [result, setResult] = useState<CheckoutRecoveryPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [exporting, setExporting] = useState(false);

  const filters = {
    kind: kind || undefined,
    productId: productId || undefined,
    from: since(period),
    state,
  };

  function load(change: () => void): void {
    setResult(null);
    setError(null);
    change();
  }

  useEffect(() => {
    const controller = new AbortController();
    api
      .listCheckoutProducts(undefined, controller.signal)
      .then(setProducts)
      // The product filter is optional; the list still works without it.
      .catch(() => undefined);
    return () => controller.abort();
  }, [api]);

  useEffect(() => {
    // A slower answer for previous filters must not replace the current one.
    const controller = new AbortController();
    api
      .listCheckoutRecovery(
        { kind: kind || undefined, productId: productId || undefined, from: since(period), state, page, pageSize: PAGE_SIZE },
        controller.signal,
      )
      .then(setResult)
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(messageOf(caught, "Não foi possível carregar a recuperação."));
      });
    return () => controller.abort();
  }, [api, kind, productId, period, state, page, reload]);

  async function exportCsv() {
    setNotice(null);
    setExporting(true);
    try {
      const blob = await api.fetchCheckoutRecoveryCsv(filters);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.setAttribute("download", "recuperacao.csv");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (caught) {
      setNotice({ error: true, text: messageOf(caught, "Não foi possível exportar a lista.") });
    } finally {
      setExporting(false);
    }
  }

  async function copyContact(item: CheckoutRecoveryItem) {
    try {
      await navigator.clipboard.writeText(contactText(item));
      setNotice({ error: false, text: "Contato copiado." });
    } catch {
      setNotice({ error: true, text: "Não foi possível copiar. Selecione o contato na lista." });
    }
  }

  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
          <RotateCcw size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-slate-900">Recuperação</h1>
          <p className="text-sm text-slate-500">
            Quem gerou o Pix e não pagou, e quem preencheu os dados e saiu. Quando a pessoa compra depois, ela aparece em Recuperados.
          </p>
        </div>
        <button type="button" className={secondaryButtonClass} onClick={() => void exportCsv()} disabled={exporting}>
          {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          Exportar CSV
        </button>
      </header>

      <div className="flex flex-wrap gap-2">
        <select aria-label="Situação" className={`${inputClass} w-auto`} value={state} onChange={(event) => load(() => { setPage(1); setState(event.target.value as "OPEN" | "RECOVERED"); })}>
          <option value="OPEN">A recuperar</option>
          <option value="RECOVERED">Recuperados</option>
        </select>
        <select aria-label="Tipo" className={`${inputClass} w-auto`} value={kind} onChange={(event) => load(() => { setPage(1); setKind(event.target.value as CheckoutRecoveryKind | ""); })}>
          <option value="">Todos os tipos</option>
          <option value="PIX">Pix não pago</option>
          <option value="LEAD">Saiu antes de gerar o Pix</option>
        </select>
        <select aria-label="Produto" className={`${inputClass} w-auto`} value={productId} onChange={(event) => load(() => { setPage(1); setProductId(event.target.value); })}>
          <option value="">Todos os produtos</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>{product.name}</option>
          ))}
        </select>
        <select aria-label="Período" className={`${inputClass} w-auto`} value={period} onChange={(event) => load(() => { setPage(1); setPeriod(event.target.value); })}>
          {PERIODS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      <NoticeText notice={notice} />

      {error ? (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertTriangle size={16} />
          {error}
          <button type="button" className="ml-auto font-semibold underline" onClick={() => load(() => setReload((value) => value + 1))}>
            Tentar de novo
          </button>
        </div>
      ) : !result ? (
        <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Carregando…</p>
      ) : result.items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          {state === "OPEN" ? "Ninguém para recuperar neste período." : "Nenhuma compra recuperada neste período."}
        </p>
      ) : (
        <ul className="space-y-2">
          {result.items.map((item) => (
            <li key={`${item.kind}-${item.id}`} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{item.name ?? "Sem nome"}</p>
                  <p className="break-words text-sm text-slate-500">
                    {[item.email, item.phone].filter(Boolean).join(" · ") || "Sem contato"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {item.reason} · {item.productName} · {formatDateTime(item.createdAt)}
                    {item.totalCents !== null && ` · ${formatCents(item.totalCents)}`}
                    {item.recovered && " · recuperado"}
                  </p>
                </div>
                {!item.recovered && (
                  <div className="flex shrink-0 gap-2">
                    {item.phone && (
                      <a
                        className={secondaryButtonClass}
                        href={recoveryWhatsAppLink(item.phone, item.name, item.productName)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <MessageCircle size={16} /> WhatsApp
                      </a>
                    )}
                    <button type="button" className={secondaryButtonClass} onClick={() => void copyContact(item)}>
                      <Copy size={16} /> Copiar contato
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {result && pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button type="button" className={secondaryButtonClass} disabled={page <= 1} onClick={() => load(() => setPage((value) => value - 1))}>Anterior</button>
          <span>Página {page} de {pages}</span>
          <button type="button" className={secondaryButtonClass} disabled={page >= pages} onClick={() => load(() => setPage((value) => value + 1))}>Próxima</button>
        </div>
      )}
    </div>
  );
}
