"use client";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import { useApiClient } from "@/lib/use-api-client";
import {
  COLLECTION_PURPOSES,
  COLLECTION_SLOT_METHODS,
  MOMENT_LABELS,
  SLOT_METHOD_LABELS,
  errorText,
  type CollectionPurpose,
  type CollectionSlotMethod,
  type TemplateRequest,
} from "./types";

const MIN = 10;
const MAX = 1000;

/**
 * Support form asking the CifraMais team for a custom WhatsApp template. The request is
 * recorded and the team is told; the template is linked later, by the platform.
 */
export function TemplateRequestDialog({
  open,
  onClose,
  onCreated,
  purpose,
  billingMethod,
  ruleStepId,
  stepLabel,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (request: TemplateRequest) => void;
  purpose?: CollectionPurpose | null;
  billingMethod?: CollectionSlotMethod | null;
  /** Step of the collection rule the template is for (from the rule screen). */
  ruleStepId?: string;
  stepLabel?: string;
}): ReactNode {
  const api = useApiClient();
  const [moment, setMoment] = useState<CollectionPurpose | "">("");
  const [method, setMethod] = useState<CollectionSlotMethod | "">("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const textArea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setMoment(purpose ?? "");
    setMethod(billingMethod ?? "");
    setMessage("");
    setError(null);
    setDone(false);
    textArea.current?.focus();
  }, [open, purpose, billingMethod]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const length = message.trim().length;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (length < MIN) {
      setError(
        `Descreva o que a mensagem deve dizer (mínimo de ${MIN} caracteres).`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api.createTemplateRequest({
        message: message.trim(),
        ...(moment ? { purpose: moment } : {}),
        ...(method ? { billingMethod: method } : {}),
        ...(ruleStepId ? { ruleStepId } : {}),
      });
      setDone(true);
      onCreated?.(created);
    } catch (caught: unknown) {
      setError(errorText(caught, "Não foi possível enviar o pedido."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-request-title"
        className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="template-request-title"
              className="text-lg font-semibold text-slate-900"
            >
              Solicitar template personalizado
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              A equipe CifraMais cria o template, envia para aprovação do
              WhatsApp e avisa quando ele estiver em uso.
            </p>
          </div>
          <button
            type="button"
            aria-label="Fechar"
            onClick={onClose}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
          >
            <X size={18} />
          </button>
        </div>

        {done ? (
          <div className="mt-5 space-y-4">
            <p
              role="status"
              className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800"
            >
              Pedido enviado. Você acompanha a situação em “Meus pedidos”.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              >
                Fechar
              </button>
            </div>
          </div>
        ) : (
          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => void submit(event)}
          >
            {stepLabel && (
              <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
                Etapa: {stepLabel}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                Momento
                <select
                  value={moment}
                  onChange={(event) =>
                    setMoment(event.target.value as CollectionPurpose | "")
                  }
                  className="h-10 rounded-md border border-slate-300 px-2 text-sm font-normal"
                >
                  <option value="">Não sei / outro</option>
                  {COLLECTION_PURPOSES.map((item) => (
                    <option key={item} value={item}>
                      {MOMENT_LABELS[item]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                Forma de pagamento
                <select
                  value={method}
                  onChange={(event) =>
                    setMethod(event.target.value as CollectionSlotMethod | "")
                  }
                  className="h-10 rounded-md border border-slate-300 px-2 text-sm font-normal"
                >
                  <option value="">Todas</option>
                  {COLLECTION_SLOT_METHODS.map((item) => (
                    <option key={item} value={item}>
                      {SLOT_METHOD_LABELS[item]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-col gap-1">
              <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                O que a mensagem deve dizer
                <textarea
                  ref={textArea}
                  rows={5}
                  maxLength={MAX}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Ex.: incluir o nome do aluno e a turma, e um tom mais informal."
                  aria-describedby="template-request-help"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                />
              </label>
              <span
                id="template-request-help"
                className="text-xs text-slate-500"
              >
                Não inclua dados de clientes. {length}/{MAX}
              </span>
            </div>
            {error && (
              <p
                role="alert"
                className="rounded-md bg-red-50 p-3 text-sm text-red-800"
              >
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy && <Loader2 size={16} className="animate-spin" />}
                Enviar pedido
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
