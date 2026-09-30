"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useApiClient } from "@/lib/use-api-client";
import {
  BLOCK_LABELS,
  STATUS_LABELS,
  errorText,
  isConflict,
  type AdminCatalogStatus,
  type AdminWhatsappTemplate,
  type WhatsappSyncState,
} from "./types";

const STATUS_FILTERS: Array<{ value: AdminCatalogStatus; label: string }> = [
  { value: "APPROVED", label: "Aprovados" },
  { value: "UNAVAILABLE", label: "Indisponíveis" },
  { value: "ALL", label: "Todos" },
];

const QUALITY_LABELS: Record<string, string> = {
  GREEN: "alta",
  YELLOW: "média",
  RED: "baixa",
  UNKNOWN: "desconhecida",
};

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString("pt-BR") : "nunca";
}

/**
 * Imported Meta catalog. Content, category and approval come from the provider: this
 * screen only filters, synchronizes and opens the variable mapping.
 */
export function WhatsappCatalog({
  onConfigure,
  refreshKey = 0,
}: {
  onConfigure: (templateId: string) => void;
  /** Bumped by the page after a mapping save so readiness is re-read. */
  refreshKey?: number;
}): ReactNode {
  const api = useApiClient();
  const [status, setStatus] = useState<AdminCatalogStatus>("APPROVED");
  const [supported, setSupported] = useState<"" | "true" | "false">("");
  const [items, setItems] = useState<AdminWhatsappTemplate[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<WhatsappSyncState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Only the latest filter's response may land; older pages are discarded.
  const request = useRef(0);

  const load = useCallback(
    async (cursor?: string): Promise<void> => {
      const id = ++request.current;
      try {
        const [page, state] = await Promise.all([
          api.getAdminWhatsappTemplates({
            status,
            supported: supported === "" ? undefined : supported === "true",
            cursor,
            limit: 25,
          }),
          cursor ? Promise.resolve(null) : api.getWhatsappTemplateSyncState(),
        ]);
        if (id !== request.current) return;
        setItems((previous) =>
          cursor ? [...(previous ?? []), ...page.items] : page.items,
        );
        setNextCursor(page.nextCursor);
        if (state) setSyncState(state);
      } catch (caught: unknown) {
        if (id === request.current)
          setError(errorText(caught, "Não foi possível carregar o catálogo."));
      }
    },
    [api, status, supported],
  );

  useEffect(() => {
    setError(null);
    void load();
  }, [load, refreshKey]);

  async function synchronize(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.syncWhatsappTemplates();
      setNotice(
        result.completed
          ? `Catálogo sincronizado: ${result.imported} novos, ${result.updated} atualizados, ${result.unavailable} indisponíveis.`
          : "Sincronização parcial: nenhum template foi marcado como indisponível. Tente novamente mais tarde.",
      );
    } catch (caught: unknown) {
      setError(
        isConflict(caught)
          ? "Uma sincronização já está em andamento. Aguarde e atualize a lista."
          : errorText(caught, "A sincronização não foi concluída."),
      );
    } finally {
      await load();
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="whatsapp-catalog" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="whatsapp-catalog" className="text-xl font-semibold">
            WhatsApp
          </h2>
          <p className="text-sm text-slate-600">
            Templates criados e aprovados no WhatsApp Manager da Meta. O
            conteúdo não é editado aqui.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          className="rounded-lg border px-4 py-2 disabled:opacity-50"
          onClick={() => void synchronize()}
        >
          Sincronizar catálogo
        </button>
      </div>
      {syncState && (
        <p className="text-sm text-slate-600">
          Última sincronização completa: {formatDate(syncState.lastCompletedAt)}
          {syncState.running && " · sincronização em andamento"}
          {syncState.lastErrorCode &&
            ` · última falha: ${syncState.lastErrorCode} em ${formatDate(syncState.lastErrorAt)}`}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-emerald-700">
          {notice}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">
          Situação
          <select
            className="ml-2 rounded-lg border p-2"
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as AdminCatalogStatus)
            }
          >
            {STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Formato
          <select
            className="ml-2 rounded-lg border p-2"
            value={supported}
            onChange={(event) =>
              setSupported(event.target.value as "" | "true" | "false")
            }
          >
            <option value="">Todos</option>
            <option value="true">Suportados</option>
            <option value="false">Não suportados</option>
          </select>
        </label>
      </div>
      {items?.map((item) => (
        <article
          key={item.id}
          aria-label={item.name}
          className="space-y-2 rounded-xl border bg-white p-5"
        >
          <h3 className="font-semibold">{item.name}</h3>
          <p className="text-sm text-slate-600">
            {item.language} · {item.category ?? "sem categoria"} ·{" "}
            {item.archivedAt
              ? "Indisponível no provedor"
              : (STATUS_LABELS[item.status] ?? item.status)}
            {item.quality &&
              ` · Qualidade ${QUALITY_LABELS[item.quality] ?? item.quality}`}
            {` · revisão ${item.providerRevision}`}
          </p>
          {item.rejectedReason && (
            <p className="text-sm text-red-700">{item.rejectedReason}</p>
          )}
          {!item.supported && (
            <p className="text-sm text-amber-800">
              <strong>Formato não suportado</strong>
              {item.supportReason ? ` (${item.supportReason})` : ""}. Ajuste o
              template na Meta; ele não pode ser liberado.
            </p>
          )}
          {item.supported && !item.readiness.ready && item.readiness.code && (
            <p className="text-sm text-amber-800">
              {BLOCK_LABELS[item.readiness.code]}
            </p>
          )}
          {item.readiness.ready && (
            <p className="text-sm text-emerald-700">Pronto para liberar</p>
          )}
          <p className="whitespace-pre-wrap rounded bg-slate-50 p-2 text-sm">
            {item.content.body}
          </p>
          {item.content.footer && (
            <p className="text-xs text-slate-500">{item.content.footer}</p>
          )}
          {item.content.button && (
            <p className="text-xs text-slate-500">
              Botão: {item.content.button.label}
            </p>
          )}
          {item.content.pixButton && (
            <p className="text-xs text-slate-500">
              Botão: {item.content.pixButton.label} (Pix da cobrança)
            </p>
          )}
          {item.content.quickReplies?.length ? (
            <p className="text-xs text-slate-500">
              Respostas rápidas: {item.content.quickReplies.join(", ")}
            </p>
          ) : null}
          <p className="text-xs text-slate-500">
            Liberado para {item.grantedCompanies}{" "}
            {item.grantedCompanies === 1 ? "empresa" : "empresas"} · última
            leitura {formatDate(item.lastSyncAt)}
          </p>
          <button
            type="button"
            disabled={!item.supported}
            className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
            onClick={() => onConfigure(item.id)}
          >
            Configurar variáveis de {item.name}
          </button>
        </article>
      ))}
      {items && items.length === 0 && (
        <p className="text-slate-500">Nenhum template neste filtro.</p>
      )}
      {nextCursor && (
        <button
          type="button"
          className="rounded-lg border px-4 py-2 text-sm"
          onClick={() => void load(nextCursor)}
        >
          Carregar mais templates
        </button>
      )}
    </section>
  );
}
