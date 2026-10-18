"use client";
import { useCallback, useEffect, useState } from "react";
import { useApiClient } from "@/lib/use-api-client";
import type {
  DisbursementBatchSummary,
  DisbursementStatus,
  Page,
} from "@/lib/api-client";
import {
  BATCH_STATUS_LABELS,
  formatCents,
  formatDateTime,
} from "@/lib/disbursements";
import { BatchDetail } from "./BatchDetail";
import { BatchEditor } from "./BatchEditor";

const PAGE_SIZE = 20;

export function BatchesPanel({ status }: { status: DisbursementStatus }) {
  const api = useApiClient();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<DisbursementBatchSummary> | null>(null);
  const [loadError, setLoadError] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  const load = useCallback(
    (signal: AbortSignal) =>
      api.listDisbursementBatches({ page, pageSize: PAGE_SIZE }, signal),
    [api, page],
  );
  useEffect(() => {
    if (openId || creating) return;
    const controller = new AbortController();
    load(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setLoadError("");
        setData(result);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setLoadError("Não foi possível carregar os lotes.");
      });
    return () => controller.abort();
  }, [load, openId, creating, refresh]);

  if (openId)
    return (
      <BatchDetail
        key={openId}
        batchId={openId}
        status={status}
        onClose={() => {
          setOpenId(null);
          setRefresh(refresh + 1);
        }}
        onOpen={setOpenId}
      />
    );
  if (creating)
    return (
      <BatchEditor
        onCancel={() => setCreating(false)}
        onSaved={(batch) => {
          setCreating(false);
          setOpenId(batch.id);
        }}
      />
    );
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  return (
    <section className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white"
        >
          Novo lote
        </button>
      </div>
      {loadError ? (
        <p role="alert" className="text-sm text-red-800">
          {loadError}
        </p>
      ) : !data ? (
        <p className="text-sm text-slate-500">Carregando lotes…</p>
      ) : !data.items.length ? (
        <p className="text-sm text-slate-500">
          Nenhum lote ainda. Cadastre os colaboradores e crie o primeiro lote.
        </p>
      ) : (
        <>
          <ul className="divide-y rounded-xl border bg-white">
            {data.items.map((batch) => (
              <li key={batch.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(batch.id)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left text-sm hover:bg-slate-50"
                >
                  <span>
                    <strong>{batch.reference}</strong> · {batch.itemCount}{" "}
                    pagamento(s) · {formatCents(batch.totalCents)}
                  </span>
                  <span className="text-slate-600">
                    {BATCH_STATUS_LABELS[batch.status]} ·{" "}
                    {formatDateTime(batch.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <div className="flex items-center gap-2 text-sm">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="rounded border px-3 py-1 disabled:opacity-50"
              >
                Anterior
              </button>
              <span>
                Página {page} de {pages}
              </span>
              <button
                type="button"
                disabled={page >= pages}
                onClick={() => setPage(page + 1)}
                className="rounded border px-3 py-1 disabled:opacity-50"
              >
                Próxima
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
