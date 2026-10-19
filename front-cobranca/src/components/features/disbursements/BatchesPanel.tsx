"use client";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, Loader2, MessageSquare, Plus, Repeat } from "lucide-react";
import { useApiClient } from "@/lib/use-api-client";
import type { DisbursementBatchSummary, DisbursementStatus, Page } from "@/lib/api-client";
import {
  BATCH_STATUS_LABELS,
  BATCH_STATUS_TONES,
  formatCents,
  formatDate,
  formatDateTime,
  repeatLabel,
} from "@/lib/disbursements";
import { TablePagination } from "@/components/ui/TablePagination";
import { BatchDetail } from "./BatchDetail";
import { BatchEditor } from "./BatchEditor";

function when(batch: DisbursementBatchSummary): string {
  return batch.scheduledFor ? formatDate(batch.scheduledFor) : formatDateTime(batch.createdAt).slice(0, 10);
}

export function BatchesPanel({ status }: { status: DisbursementStatus }) {
  const api = useApiClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<Page<DisbursementBatchSummary> | null>(null);
  const [loadError, setLoadError] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  const load = useCallback(
    (signal: AbortSignal) => api.listDisbursementBatches({ page, pageSize }, signal),
    [api, page, pageSize],
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
        if (!controller.signal.aborted) setLoadError("Não foi possível carregar os pagamentos.");
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
        status={status}
        onCancel={() => {
          setCreating(false);
          setRefresh(refresh + 1);
        }}
        onSaved={(batch) => {
          setCreating(false);
          setOpenId(batch.id);
        }}
      />
    );

  const approver = status.approverName ?? "o responsável";
  return (
    <section className="space-y-4">
      <ol className="grid gap-3 rounded-md border border-slate-200 bg-white p-4 text-sm sm:grid-cols-3">
        {[
          [CalendarClock, "1. Cadastre e agende", "Escolha os colaboradores, os valores e a data. Pode repetir."],
          [MessageSquare, "2. Confirmação no WhatsApp", `Na data, às 08:00, ${approver} confirma até 23:59.`],
          [CheckCircle2, "3. Pix enviado", "Confirmado, os Pix saem na hora da conta Efí da empresa."],
        ].map(([Icon, title, text]) => {
          const StepIcon = Icon as typeof CalendarClock;
          return (
            <li key={title as string} className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                <StepIcon size={16} />
              </span>
              <span>
                <span className="block font-semibold text-slate-900">{title as string}</span>
                <span className="block text-xs text-slate-500">{text as string}</span>
              </span>
            </li>
          );
        })}
      </ol>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          <Plus size={16} /> Novo pagamento
        </button>
      </div>

      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        {loadError ? (
          <div role="alert" className="flex min-h-40 flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-slate-700">{loadError}</p>
            <button
              type="button"
              onClick={() => setRefresh(refresh + 1)}
              className="rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Tentar de novo
            </button>
          </div>
        ) : !data ? (
          <p className="flex min-h-40 items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" /> Carregando pagamentos…
          </p>
        ) : !data.items.length ? (
          <p className="flex min-h-40 items-center justify-center px-6 text-center text-sm text-slate-500">
            Nenhum pagamento ainda. Cadastre os colaboradores e crie o primeiro pagamento.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {data.items.map((batch) => (
                <li key={batch.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(batch.id)}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 text-left text-sm hover:bg-slate-50 sm:grid-cols-[minmax(0,1fr)_8rem_10rem_11rem]"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 truncate font-medium text-slate-900">
                        {batch.reference}
                        {batch.schedule?.status === "ACTIVE" && (
                          <Repeat size={13} className="shrink-0 text-slate-400" aria-label="Repete" />
                        )}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {batch.itemCount} {batch.itemCount === 1 ? "colaborador" : "colaboradores"}
                        {batch.schedule?.status === "ACTIVE" &&
                          ` · repete ${repeatLabel(batch.schedule.unit, batch.schedule.every)}`}
                      </span>
                    </span>
                    <span className="order-3 text-xs tabular-nums text-slate-600 sm:order-none sm:text-sm">{when(batch)}</span>
                    <span className="order-2 text-right font-semibold tabular-nums text-slate-900 sm:order-none">
                      {formatCents(batch.totalCents)}
                    </span>
                    <span className="order-4 flex items-center justify-end gap-1.5 sm:order-none sm:justify-start">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${BATCH_STATUS_TONES[batch.status]}`}>
                        {BATCH_STATUS_LABELS[batch.status]}
                      </span>
                      {batch.scheduleProblem && batch.status === "DRAFT" && (
                        <AlertTriangle size={15} className="text-amber-600" aria-label="Precisa de atenção" />
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <TablePagination
              page={page}
              pageSize={pageSize}
              total={data.total}
              pageSizeLabel="Pagamentos por página"
              onChange={(next) => {
                setPage(next.page);
                setPageSize(next.pageSize);
              }}
            />
          </>
        )}
      </div>
    </section>
  );
}
