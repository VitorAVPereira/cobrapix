"use client";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import {
  WhatsappMessagePreview,
  previewButtons,
} from "@/components/features/templates/WhatsappMessagePreview";
import {
  COLLECTION_SLOT_METHODS,
  MOMENT_HINTS,
  MOMENT_LABELS,
  SLOT_METHOD_LABELS,
  type CollectionPurpose,
  type CollectionSlotMethod,
  type CompanyCollectionTemplates,
} from "@/components/features/templates/types";
import { dayLabel, type RuleDay } from "./rule-days";

const OVERDUE: CollectionPurpose[] = [
  "FIRST_OVERDUE",
  "CRITICAL_OVERDUE",
  "RECURRING_OVERDUE",
];

/** The WhatsApp message a contact sends, per payment method, with example data. */
export function DayMessageDialog({
  row,
  templates,
  onClose,
}: {
  row: RuleDay | null;
  templates: CompanyCollectionTemplates | null;
  onClose: () => void;
}): ReactNode {
  const [method, setMethod] = useState<CollectionSlotMethod>("PIX");
  const [overdue, setOverdue] = useState<CollectionPurpose>("FIRST_OVERDUE");

  useEffect(() => {
    if (!row) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [row, onClose]);

  if (!row) return null;
  const purpose: CollectionPurpose =
    row.day < 0 ? "BEFORE_DUE" : row.day === 0 ? "DUE_TODAY" : overdue;
  const stepId = row.channels.WHATSAPP?.id;
  const custom = stepId
    ? templates?.custom.find(
        (item) => item.ruleStepId === stepId && item.billingMethod === method,
      )
    : undefined;
  const template =
    custom?.template ??
    templates?.moments.find(
      (item) => item.purpose === purpose && item.billingMethod === method,
    )?.template ??
    null;
  const title = `${MOMENT_LABELS[purpose]} · ${SLOT_METHOD_LABELS[method]}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="day-message-title"
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="day-message-title"
              className="text-lg font-semibold text-slate-900"
            >
              Mensagem: {dayLabel(row.day)}
            </h2>
            <p className="text-sm text-slate-500">{MOMENT_HINTS[purpose]}</p>
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

        {row.day > 0 && (
          <div
            role="group"
            aria-label="Mensagem de atraso"
            className="mt-4 flex flex-wrap gap-1.5"
          >
            {OVERDUE.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={overdue === item}
                onClick={() => setOverdue(item)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  overdue === item
                    ? "bg-slate-900 text-white"
                    : "border border-slate-200 text-slate-600"
                }`}
              >
                {MOMENT_LABELS[item]}
              </button>
            ))}
          </div>
        )}

        <div
          role="group"
          aria-label="Forma de pagamento"
          className="mt-3 flex gap-1.5"
        >
          {COLLECTION_SLOT_METHODS.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={method === item}
              onClick={() => setMethod(item)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                method === item
                  ? "bg-emerald-600 text-white"
                  : "border border-slate-200 text-slate-600"
              }`}
            >
              {SLOT_METHOD_LABELS[item]}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-2">
          {custom && (
            <p className="text-xs font-medium text-violet-700">
              Template personalizado desta etapa.
            </p>
          )}
          {!templates ? (
            <p className="text-sm text-slate-500">Carregando mensagem...</p>
          ) : template ? (
            <WhatsappMessagePreview
              label={`Prévia da mensagem ${title}`}
              body={template.previewBody ?? template.content.body}
              footer={template.content.footer}
              buttons={previewButtons(template.content)}
            />
          ) : (
            <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
              Esta mensagem ainda está em preparação pela CifraMais. Até lá, os
              envios deste momento ficam aguardando.
            </p>
          )}
          {row.channels.EMAIL && (
            <p className="text-xs text-slate-500">
              O e-mail usa o modelo de “{MOMENT_LABELS[purpose]}” da aba E-mail
              em Templates.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
