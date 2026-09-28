"use client";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { useApiClient } from "@/lib/use-api-client";
import {
  errorText,
  isConflict,
  resumeReasonLabel,
  type ResumeAction,
  type ResumeResult,
  type ResumeReview,
} from "./types";

const GROUPS: Array<{ action: ResumeAction; title: string; empty: string }> = [
  {
    action: "RESUME",
    title: "Serão retomados",
    empty: "Nenhum envio pode ser retomado.",
  },
  {
    action: "CLOSE",
    title: "Serão encerrados sem mensagem",
    empty: "Nenhuma pendência será encerrada.",
  },
  {
    action: "KEEP_BLOCKED",
    title: "Continuam bloqueados",
    empty: "Nenhuma pendência continua bloqueada.",
  },
];

function conflictCode(error: unknown): string | null {
  const data = (error as { data?: unknown }).data;
  return typeof data === "object" && data !== null && "code" in data
    ? String((data as { code: unknown }).code)
    : null;
}

/**
 * Preview of a resume and its explicit confirmation. The idempotency key belongs to this
 * review: double clicks and retries after a timeout reuse it, so the server returns the
 * recorded result instead of resuming twice. A conflict invalidates the preview.
 */
export function TemplateResumeReview({
  review,
  onConfirmed,
  onInvalidated,
  onCancel,
}: {
  review: ResumeReview;
  onConfirmed: (result: ResumeResult) => void;
  onInvalidated: () => void;
  onCancel: () => void;
}): ReactNode {
  const api = useApiClient();
  const key = useRef<string | null>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [result, setResult] = useState<ResumeResult | null>(null);
  const resumable = review.items.some((item) => item.action !== "KEEP_BLOCKED");

  async function confirm(): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    key.current ??= crypto.randomUUID();
    setBusy(true);
    setError(null);
    try {
      const confirmed = await api.confirmTemplateResume(review.id, key.current);
      setResult(confirmed);
      onConfirmed(confirmed);
    } catch (caught: unknown) {
      if (isConflict(caught)) {
        setInvalid(
          conflictCode(caught) === "REVIEW_EXPIRED"
            ? "A prévia expirou. Revise novamente."
            : "A pendência mudou. Revise novamente.",
        );
        onInvalidated();
      } else
        setError(
          `${errorText(caught, "A confirmação não foi concluída.")} Tente confirmar novamente: a mesma autorização será usada.`,
        );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (result)
    return (
      <section
        aria-label="Resultado da retomada"
        className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm"
      >
        <p className="font-semibold text-emerald-800">Retomada autorizada</p>
        <p>
          {result.intentIds.length} envio(s) aguardando envio.{" "}
          {result.closedPendingIds.length} pendência(s) encerrada(s) sem
          mensagem.
        </p>
        <p className="text-slate-600">
          O status de entrega aparece no histórico de comunicações conforme o
          provedor confirmar.
        </p>
      </section>
    );

  return (
    <section
      aria-label="Prévia da retomada"
      className="space-y-4 rounded-xl border border-indigo-200 bg-white p-5"
    >
      <div>
        <h3 className="font-semibold">Prévia da retomada</h3>
        <p className="text-sm text-slate-600">
          Válida até {new Date(review.expiresAt).toLocaleTimeString("pt-BR")}.
          Nada foi enviado ainda: confirme para autorizar.
        </p>
      </div>
      {GROUPS.map((group) => {
        const items = review.items.filter(
          (item) => item.action === group.action,
        );
        return (
          <div key={group.action} className="space-y-2">
            <h4 className="text-sm font-medium">
              {group.title} ({items.length})
            </h4>
            {items.length === 0 && (
              <p className="text-xs text-slate-500">{group.empty}</p>
            )}
            {items.map((item) => (
              <div
                key={item.pendingId}
                className="rounded-lg border p-3 text-sm"
              >
                <p>
                  {item.templateName ?? "Sem template"}
                  {item.invoiceId && " · cobrança vinculada"}
                </p>
                {item.reason && (
                  <p className="text-xs text-amber-800">
                    {resumeReasonLabel(item.reason)}
                  </p>
                )}
                {item.previewBody && (
                  <p
                    aria-label="Mensagem que será enviada"
                    className="mt-1 whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs"
                  >
                    {item.previewBody}
                  </p>
                )}
              </div>
            ))}
          </div>
        );
      })}
      {invalid ? (
        <div className="space-y-2">
          <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-900">
            {invalid}
          </p>
          <button
            type="button"
            className="rounded-lg border px-4 py-2 text-sm"
            onClick={onCancel}
          >
            Revisar novamente
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !resumable}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            onClick={() => void confirm()}
          >
            Autorizar retomada
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded-lg border px-4 py-2 text-sm"
            onClick={onCancel}
          >
            Cancelar
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
    </section>
  );
}
