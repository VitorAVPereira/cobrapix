"use client";

import { Loader2, Upload } from "lucide-react";
import type { ImportClientReview, ImportDecision } from "@/lib/api-client";

/** Last step before writing: what will be imported and what was left out. */
export function ImportSummary({
  rows,
  clients,
  decisions,
  busy,
  whatsappConsent,
  onWhatsappConsentChange,
  onConfirm,
  onCancel,
}: {
  rows: number;
  clients: ImportClientReview[];
  decisions: ImportDecision[];
  busy: boolean;
  /** Consent for every client of the spreadsheet at once. */
  whatsappConsent: boolean;
  onWhatsappConsentChange: (value: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const skipped = new Set(
    decisions.filter((decision) => decision.action === "SKIP").map((d) => d.document),
  );
  const kept = clients.filter((client) => !skipped.has(client.document));
  const skippedClients = clients.filter((client) => skipped.has(client.document));
  const charges = kept.reduce((total, client) => total + client.rows.length, 0);
  const created = kept.filter((client) => client.kind === "NEW").length;
  const count = (value: number) => value.toLocaleString("pt-BR");

  return (
    <div className="space-y-4">
      <dl className="grid gap-3 sm:grid-cols-3">
        {[
          ["Cobranças a importar", `${count(charges)} de ${count(rows)}`],
          ["Clientes novos", count(created)],
          ["Clientes já cadastrados", count(kept.length - created)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-md bg-slate-50 px-4 py-3">
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="mt-1 text-xl font-semibold text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>

      {skippedClients.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-semibold">
            Ficam de fora as cobranças de {count(skippedClients.length)}{" "}
            {skippedClients.length === 1 ? "cliente" : "clientes"}:
          </p>
          <p className="mt-1">
            {skippedClients
              .map((client) => `${client.csv.name} (linhas ${client.rows.map((row) => row + 1).join(", ")})`)
              .join("; ")}
          </p>
        </div>
      )}

      <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={whatsappConsent}
          onChange={(event) => onWhatsappConsentChange(event.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
        />
        <span>
          Todos os clientes desta planilha autorizaram receber cobranças pelo WhatsApp
          <span className="block text-xs text-slate-500">
            Sem marcar, vale a coluna de autorização de cada linha.
          </span>
        </span>
      </label>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
        >
          Escolher outra planilha
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy || charges === 0}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          Importar {count(charges)} {charges === 1 ? "cobrança" : "cobranças"}
        </button>
      </div>
    </div>
  );
}
