"use client";
import { useCallback, useEffect, useState } from "react";
import { useApiClient } from "@/lib/use-api-client";
import type { DisbursementBatch, DisbursementStatus } from "@/lib/api-client";
import {
  BATCH_STATUS_LABELS,
  ITEM_STATUS_LABELS,
  errorCode,
  formatCents,
  formatDateTime,
  maskDocument,
} from "@/lib/disbursements";
import { BatchEditor } from "./BatchEditor";

/** What the company needs to know about the batch now, in plain words. */
function situation(batch: DisbursementBatch, status: DisbursementStatus): string {
  switch (batch.status) {
    case "DRAFT":
      return "Rascunho: nada foi enviado. Revise e peça a aprovação.";
    case "AWAITING_APPROVAL":
      return `Aguardando aprovação no WhatsApp de ${status.approverName ?? "aprovador"}${
        batch.approval ? ` até ${formatDateTime(batch.approval.expiresAt)}` : ""
      }. Ao aprovar, os Pix são enviados na hora.`;
    case "PROCESSING":
      return "Aprovado: os Pix estão sendo enviados.";
    case "COMPLETED":
      return "Concluído: todos os pagamentos foram feitos.";
    case "COMPLETED_WITH_FAILURES":
      return "Concluído com falhas: veja o motivo de cada pagamento não feito. Eles só são pagos em um novo lote, com nova aprovação.";
    case "REJECTED":
      return "Recusado pelo aprovador: nenhum pagamento foi feito.";
    case "EXPIRED":
      return "Expirado: o aprovador não respondeu em 24 horas. Nada foi pago pelo CifraMais; faça o pagamento manualmente.";
    case "CANCELED":
      return "Cancelado: nenhum pagamento deste lote foi enviado.";
  }
}

export function BatchDetail({
  batchId,
  status,
  onClose,
  onOpen,
}: {
  batchId: string;
  status: DisbursementStatus;
  onClose: () => void;
  onOpen: (batchId: string) => void;
}) {
  const api = useApiClient();
  const [batch, setBatch] = useState<DisbursementBatch | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(
    async (signal?: AbortSignal) => {
      const loaded = await api.getDisbursementBatch(batchId, signal);
      if (!signal?.aborted) setBatch(loaded);
    },
    [api, batchId],
  );
  useEffect(() => {
    const controller = new AbortController();
    reload(controller.signal).catch(() => {
      if (!controller.signal.aborted)
        setLoadError("Não foi possível carregar o lote.");
    });
    return () => controller.abort();
  }, [reload]);

  async function act(run: () => Promise<DisbursementBatch>, done: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await run();
      setBatch(updated);
      setNotice(done);
      return updated;
    } catch (e) {
      const code = errorCode(e);
      if (code === "VERSION_CHANGED" || code === "BATCH_NOT_DRAFT")
        await reload().catch(() => undefined);
      setError(
        code === "VERSION_CHANGED"
          ? "O lote foi alterado por outra pessoa. Os dados foram recarregados; confira antes de continuar."
          : e instanceof Error
            ? e.message
            : "Não foi possível concluir a ação.",
      );
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function receipt(itemId: string) {
    setError("");
    try {
      const blob = await api.fetchDisbursementReceipt(itemId);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.setAttribute("download", `comprovante-${itemId}.pdf`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Comprovante indisponível no momento.",
      );
    }
  }

  if (loadError)
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-red-800">
          {loadError}
        </p>
        <button type="button" onClick={onClose} className="rounded border px-3 py-1 text-sm">
          Voltar
        </button>
      </div>
    );
  if (!batch) return <p className="text-sm text-slate-500">Carregando lote…</p>;
  if (editing)
    return (
      <BatchEditor
        batch={batch}
        onCancel={() => setEditing(false)}
        onSaved={(saved) => {
          setBatch(saved);
          setEditing(false);
          setNotice("Rascunho salvo.");
        }}
      />
    );
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{batch.reference}</h2>
          <p className="text-sm text-slate-600">
            {BATCH_STATUS_LABELS[batch.status]} · {batch.itemCount} pagamento(s)
            · total {formatCents(batch.totalCents)}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded border px-3 py-1 text-sm">
          Voltar aos lotes
        </button>
      </div>
      <p className="rounded-lg bg-slate-50 p-3 text-sm">{situation(batch, status)}</p>
      {notice && (
        <p role="status" className="text-sm text-emerald-700">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2 text-sm">
        {batch.status === "DRAFT" && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(true)}
              className="rounded-lg border px-3 py-2"
            >
              Editar
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    `Enviar o pedido de aprovação de ${batch.itemCount} pagamento(s), total ${formatCents(batch.totalCents)}, para o WhatsApp de ${status.approverName} ${status.approverPhoneMasked}? Ao aprovar, os Pix saem na hora.`,
                  )
                )
                  void act(
                    () => api.requestDisbursementApproval(batch.id, batch.version),
                    "Pedido de aprovação enviado ao WhatsApp do aprovador.",
                  );
              }}
              className="rounded-lg bg-indigo-600 px-3 py-2 font-semibold text-white disabled:opacity-50"
            >
              Pedir aprovação
            </button>
          </>
        )}
        {(batch.status === "DRAFT" || batch.status === "AWAITING_APPROVAL") && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Cancelar este lote? Nenhum pagamento dele será feito."))
                void act(() => api.cancelDisbursementBatch(batch.id), "Lote cancelado.");
            }}
            className="rounded-lg border px-3 py-2"
          >
            Cancelar lote
          </button>
        )}
        {batch.status === "COMPLETED_WITH_FAILURES" &&
          batch.items.some((item) => item.status === "FAILED") && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(
                  () => api.retryDisbursementFailures(batch.id),
                  "Novo lote criado com os pagamentos que falharam.",
                ).then((created) => {
                  if (created) onOpen(created.id);
                })
              }
              className="rounded-lg border px-3 py-2"
            >
              Novo lote com os pagamentos que falharam
            </button>
          )}
      </div>
      <ul className="divide-y rounded-xl border bg-white">
        {batch.items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <span>
              <strong>{item.recipientName}</strong> · {maskDocument(item.document)} ·{" "}
              {formatCents(item.amountCents)} ·{" "}
              <span className={item.status === "FAILED" ? "text-red-800" : undefined}>
                {ITEM_STATUS_LABELS[item.status]}
              </span>
              {item.failureReason && ` · ${item.failureReason}`}
            </span>
            {item.status === "PAID" && (
              <button
                type="button"
                onClick={() => void receipt(item.id)}
                className="rounded border px-3 py-1"
              >
                Comprovante
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
