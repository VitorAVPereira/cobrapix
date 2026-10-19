"use client";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, CalendarClock, CheckCircle2, Loader2, MessageSquare, Repeat, Send } from "lucide-react";
import { useApiClient } from "@/lib/use-api-client";
import type { DisbursementBatch, DisbursementStatus } from "@/lib/api-client";
import {
  BATCH_STATUS_LABELS,
  BATCH_STATUS_TONES,
  ITEM_STATUS_LABELS,
  errorCode,
  formatCents,
  formatDate,
  formatDateTime,
  maskDocument,
  repeatEndLabel,
  repeatLabel,
} from "@/lib/disbursements";
import { BatchEditor } from "./BatchEditor";

type Step = "done" | "current" | "todo" | "stopped";

/** The three steps of a payment and where this one is. */
function steps(batch: DisbursementBatch): [Step, Step, Step] {
  switch (batch.status) {
    case "DRAFT":
    case "SCHEDULED":
      return ["current", "todo", "todo"];
    case "AWAITING_APPROVAL":
      return ["done", "current", "todo"];
    case "PROCESSING":
      return ["done", "done", "current"];
    case "COMPLETED":
    case "COMPLETED_WITH_FAILURES":
      return ["done", "done", "done"];
    case "REJECTED":
    case "EXPIRED":
      return ["done", "stopped", "todo"];
    case "CANCELED":
      return ["stopped", "todo", "todo"];
  }
}

/** What the company needs to know now, in plain words. */
function situation(batch: DisbursementBatch, approver: string): string {
  switch (batch.status) {
    case "DRAFT":
      return batch.scheduleProblem
        ? "Edite o pagamento e escolha uma data para agendar de novo. Nada foi pago."
        : "Ainda sem data: edite e escolha quando pagar. Nada foi enviado.";
    case "SCHEDULED":
      return `Em ${formatDate(batch.scheduledFor!)}, às 08:00, ${approver} recebe o pedido de confirmação no WhatsApp. Até lá, você pode editar ou cancelar.`;
    case "AWAITING_APPROVAL":
      return `Aguardando a confirmação de ${approver} no WhatsApp${
        batch.approval ? ` até ${formatDateTime(batch.approval.expiresAt)}` : ""
      }. Ao confirmar, os Pix saem na hora.`;
    case "PROCESSING":
      return "Confirmado: os Pix estão sendo enviados.";
    case "COMPLETED":
      return "Pago: todos os Pix foram feitos.";
    case "COMPLETED_WITH_FAILURES":
      return "Pago com falhas: veja o motivo de cada Pix não feito. Eles só são pagos em um novo pagamento, com nova confirmação.";
    case "REJECTED":
      return `${approver} recusou no WhatsApp: nenhum Pix foi feito.`;
    case "EXPIRED":
      return `${approver} não confirmou até o fim do dia. Nada foi pago pelo CifraMais; se ainda for devido, pague manualmente.`;
    case "CANCELED":
      return "Cancelado: nenhum Pix deste pagamento foi enviado.";
  }
}

function StepItem({ state, icon: Icon, title, text }: { state: Step; icon: typeof Send; title: string; text: string }) {
  const tone =
    state === "done"
      ? "bg-emerald-600 text-white"
      : state === "current"
        ? "bg-emerald-100 text-emerald-700 ring-2 ring-emerald-500"
        : state === "stopped"
          ? "bg-rose-100 text-rose-700"
          : "bg-slate-100 text-slate-400";
  return (
    <li className="flex flex-1 items-start gap-3">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tone}`}>
        <Icon size={16} />
      </span>
      <span>
        <span className={`block text-sm font-semibold ${state === "todo" ? "text-slate-400" : "text-slate-900"}`}>{title}</span>
        <span className="block text-xs text-slate-500">{text}</span>
      </span>
    </li>
  );
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
  const approver = status.approverName ?? "O responsável";

  const reload = useCallback(
    async (signal?: AbortSignal) => {
      const loaded = await api.getDisbursementBatch(batchId, signal);
      if (signal?.aborted) return;
      setLoadError("");
      setBatch(loaded);
    },
    [api, batchId],
  );
  useEffect(() => {
    const controller = new AbortController();
    reload(controller.signal).catch(() => {
      if (!controller.signal.aborted) setLoadError("Não foi possível carregar o pagamento.");
    });
    return () => controller.abort();
  }, [reload]);

  async function act(run: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await run();
      await reload();
      setNotice(done);
      return result;
    } catch (e) {
      const code = errorCode(e);
      if (code === "VERSION_CHANGED" || code === "BATCH_NOT_DRAFT" || code === "BATCH_NOT_EDITABLE")
        await reload().catch(() => undefined);
      setError(
        code === "VERSION_CHANGED"
          ? "O pagamento foi alterado por outra pessoa. Os dados foram recarregados; confira antes de continuar."
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
      setError(e instanceof Error ? e.message : "Comprovante indisponível no momento.");
    }
  }

  const back = (
    <button
      type="button"
      onClick={onClose}
      className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
    >
      <ArrowLeft size={15} /> Voltar aos pagamentos
    </button>
  );

  if (loadError)
    return (
      <div className="space-y-3">
        <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {loadError}
        </p>
        {back}
      </div>
    );
  if (!batch)
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 size={16} className="animate-spin" /> Carregando pagamento…
      </p>
    );
  if (editing)
    return (
      <BatchEditor
        batch={batch}
        status={status}
        onCancel={() => {
          setEditing(false);
          // A save that scheduled but could not ask may have changed it.
          void reload().catch(() => undefined);
        }}
        onSaved={(saved) => {
          setBatch(saved);
          setEditing(false);
          setError("");
          setNotice(saved.status === "AWAITING_APPROVAL" ? "Pedido de confirmação enviado." : "Pagamento agendado.");
        }}
      />
    );

  const [scheduled, confirmed, sent] = steps(batch);
  const editable = batch.status === "DRAFT" || batch.status === "SCHEDULED";
  const cancelable = editable || batch.status === "AWAITING_APPROVAL";
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-slate-900">
            {batch.reference}
            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${BATCH_STATUS_TONES[batch.status]}`}>
              {BATCH_STATUS_LABELS[batch.status]}
            </span>
          </h2>
          <p className="text-sm text-slate-500">
            {batch.itemCount} {batch.itemCount === 1 ? "colaborador" : "colaboradores"} · total {formatCents(batch.totalCents)}
            {batch.schedule &&
              ` · repete ${repeatLabel(batch.schedule.unit, batch.schedule.every)}${
                batch.schedule.status === "ENDED" ? " (repetição encerrada)" : `, ${repeatEndLabel(batch.schedule)}`
              }`}
          </p>
        </div>
        {back}
      </div>

      <ol className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white p-4 sm:flex-row">
        <StepItem
          state={scheduled}
          icon={CalendarClock}
          title={batch.status === "DRAFT" ? "Agendar" : "Agendado"}
          text={
            batch.status === "DRAFT" || !batch.scheduledFor
              ? "Escolha a data do pagamento"
              : `${formatDate(batch.scheduledFor)}, às 08:00`
          }
        />
        <StepItem state={confirmed} icon={MessageSquare} title="Confirmação no WhatsApp" text={`${approver}, até 23:59 da data`} />
        <StepItem state={sent} icon={CheckCircle2} title="Pix enviado" text="Na hora da confirmação" />
      </ol>

      {batch.scheduleProblem && batch.status === "DRAFT" && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            <strong>Não foi para confirmação na data.</strong> {batch.scheduleProblem}
          </span>
        </p>
      )}
      <p className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">{situation(batch, approver)}</p>
      {notice && (
        <p role="status" className="text-sm text-emerald-700">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2 text-sm">
        {editable && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditing(true)}
            className="rounded-md bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {batch.status === "DRAFT" ? "Editar e agendar" : "Editar"}
          </button>
        )}
        {cancelable && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Cancelar este pagamento? Nenhum Pix dele será feito."))
                void act(() => api.cancelDisbursementBatch(batch.id), "Pagamento cancelado.");
            }}
            className="rounded-md border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-100"
          >
            Cancelar pagamento
          </button>
        )}
        {batch.schedule?.status === "ACTIVE" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  "Encerrar a repetição? Não serão criados novos pagamentos, e o próximo que ainda não pediu confirmação será cancelado.",
                )
              )
                void act(
                  () => api.endDisbursementSchedule(batch.schedule!.id, batch.schedule!.version),
                  "Repetição encerrada.",
                );
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-100"
          >
            <Repeat size={15} /> Encerrar repetição
          </button>
        )}
        {batch.status === "COMPLETED_WITH_FAILURES" && batch.items.some((item) => item.status === "FAILED") && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void act(
                () => api.retryDisbursementFailures(batch.id),
                "Novo pagamento criado com os Pix que falharam.",
              ).then((created) => {
                if (created) onOpen((created as DisbursementBatch).id);
              })
            }
            className="rounded-md border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-100"
          >
            Novo pagamento com os que falharam
          </button>
        )}
      </div>

      <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
        {batch.items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
            <span className="min-w-0">
              <span className="block font-medium text-slate-900">{item.recipientName}</span>
              <span className="block text-xs text-slate-500">
                {maskDocument(item.document)}
                {item.failureReason && <span className="text-rose-600"> · {item.failureReason}</span>}
              </span>
            </span>
            <span className="flex items-center gap-3">
              <span className="font-semibold tabular-nums text-slate-900">{formatCents(item.amountCents)}</span>
              {!editable && (
                <span className={`text-xs ${item.status === "FAILED" ? "text-rose-600" : "text-slate-500"}`}>
                  {ITEM_STATUS_LABELS[item.status]}
                </span>
              )}
              {item.status === "PAID" && (
                <button
                  type="button"
                  onClick={() => void receipt(item.id)}
                  className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Comprovante
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
