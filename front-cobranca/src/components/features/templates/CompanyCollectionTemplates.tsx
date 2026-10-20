"use client";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { MessageSquarePlus, RefreshCw } from "lucide-react";
import { useApiClient } from "@/lib/use-api-client";
import { TemplateRequestDialog } from "./TemplateRequestDialog";
import {
  WhatsappMessagePreview,
  previewButtons,
} from "./WhatsappMessagePreview";
import {
  COLLECTION_PURPOSES,
  COLLECTION_SLOT_METHODS,
  MOMENT_HINTS,
  MOMENT_LABELS,
  REQUEST_STATUS_LABELS,
  SLOT_METHOD_LABELS,
  errorText,
  scheduleDayLabel,
  type CollectionPurpose,
  type CollectionSlotMethod,
  type CollectionTemplateView,
  type CompanyCollectionTemplates as CollectionView,
  type TemplateRequest,
} from "./types";

type Selection =
  | { kind: "moment"; purpose: CollectionPurpose; method: CollectionSlotMethod }
  | { kind: "custom"; ruleStepId: string; method: CollectionSlotMethod };

const STATUS_TONES: Record<TemplateRequest["status"], string> = {
  OPEN: "bg-sky-50 text-sky-700",
  IN_PROGRESS: "bg-amber-50 text-amber-800",
  DONE: "bg-emerald-50 text-emerald-700",
  REJECTED: "bg-slate-100 text-slate-600",
};

/**
 * The WhatsApp messages the company's payers receive: one template per collection moment
 * and payment method, chosen automatically when sending. Read only; a different text is
 * asked for through the support form.
 */
export function CompanyCollectionTemplates(): ReactNode {
  const api = useApiClient();
  const [view, setView] = useState<CollectionView | null>(null);
  const [requests, setRequests] = useState<TemplateRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>({
    kind: "moment",
    purpose: "BEFORE_DUE",
    method: "PIX",
  });
  const [requesting, setRequesting] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([api.getCollectionTemplates(), api.getTemplateRequests()])
      .then(([templates, own]) => {
        if (!active) return;
        setView(templates);
        setRequests(own);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            errorText(caught, "Não foi possível carregar as mensagens."),
          );
      });
    return () => {
      active = false;
    };
  }, [api, reloadKey]);

  const moment = (purpose: CollectionPurpose, method: CollectionSlotMethod) =>
    view?.moments.find(
      (item) => item.purpose === purpose && item.billingMethod === method,
    )?.template ?? null;

  const selected: {
    template: CollectionTemplateView | null;
    title: string;
    hint: string;
  } =
    selection.kind === "moment"
      ? {
          template: moment(selection.purpose, selection.method),
          title: `${MOMENT_LABELS[selection.purpose]} · ${SLOT_METHOD_LABELS[selection.method]}`,
          hint: MOMENT_HINTS[selection.purpose],
        }
      : (() => {
          const custom = view?.custom.find(
            (item) =>
              item.ruleStepId === selection.ruleStepId &&
              item.billingMethod === selection.method,
          );
          return {
            template: custom?.template ?? null,
            title: `Personalizado · ${SLOT_METHOD_LABELS[selection.method]}`,
            hint: custom
              ? `${custom.profileName}: ${scheduleDayLabel(custom.scheduleDay)}.`
              : "",
          };
        })();

  if (error)
    return (
      <p
        role="alert"
        className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 p-3 text-red-800"
      >
        {error}
        <button
          type="button"
          onClick={() => {
            setError(null);
            setReloadKey((key) => key + 1);
          }}
          className="inline-flex items-center gap-1 underline"
        >
          <RefreshCw size={14} /> Tentar novamente
        </button>
      </p>
    );
  if (!view)
    return <p className="text-sm text-slate-500">Carregando mensagens...</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-600">
          A régua escolhe a mensagem sozinha, pelo momento da cobrança e pela
          forma de pagamento. Clique em uma mensagem para ver como o cliente a
          recebe.
        </p>
        <button
          type="button"
          onClick={() => setRequesting(true)}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
        >
          <MessageSquarePlus size={16} /> Solicitar template personalizado
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-3">
          {COLLECTION_PURPOSES.map((purpose) => (
            <section
              key={purpose}
              aria-labelledby={`moment-${purpose}`}
              className="rounded-lg border border-slate-200 bg-white p-3"
            >
              <h3
                id={`moment-${purpose}`}
                className="text-sm font-semibold text-slate-900"
              >
                {MOMENT_LABELS[purpose]}
              </h3>
              <p className="text-xs text-slate-500">{MOMENT_HINTS[purpose]}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {COLLECTION_SLOT_METHODS.map((method) => {
                  const template = moment(purpose, method);
                  const active =
                    selection.kind === "moment" &&
                    selection.purpose === purpose &&
                    selection.method === method;
                  return (
                    <button
                      key={method}
                      type="button"
                      aria-pressed={active}
                      aria-label={`${MOMENT_LABELS[purpose]} · ${SLOT_METHOD_LABELS[method]}`}
                      onClick={() =>
                        setSelection({ kind: "moment", purpose, method })
                      }
                      className={`rounded-md border px-3 py-2 text-left transition ${
                        active
                          ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500"
                          : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <span className="block text-xs font-semibold text-slate-700">
                        {SLOT_METHOD_LABELS[method]}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500">
                        {template
                          ? (template.previewBody ?? template.content.body)
                          : "Em preparação pela CifraMais"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <aside
          className="space-y-3 lg:sticky lg:top-4 lg:self-start"
          aria-live="polite"
        >
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              {selected.title}
            </h3>
            <p className="text-xs text-slate-500">{selected.hint}</p>
          </div>
          {selected.template ? (
            <WhatsappMessagePreview
              label={`Prévia da mensagem ${selected.title}`}
              body={
                selected.template.previewBody ?? selected.template.content.body
              }
              footer={selected.template.content.footer}
              buttons={previewButtons(selected.template.content)}
            />
          ) : (
            <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
              Esta mensagem ainda está em preparação pela CifraMais. Até lá, os
              envios deste momento ficam aguardando.
            </p>
          )}
          <p className="text-xs text-slate-500">
            Nome, valor, vencimento e link são exemplos; cada cliente recebe os
            próprios dados.
          </p>
        </aside>
      </div>

      {view.custom.length > 0 && (
        <section aria-labelledby="custom-templates" className="space-y-2">
          <h3
            id="custom-templates"
            className="text-base font-semibold text-slate-900"
          >
            Personalizados da sua empresa
          </h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {view.custom.map((item) => (
              <li key={`${item.ruleStepId}-${item.billingMethod}`}>
                <button
                  type="button"
                  onClick={() =>
                    setSelection({
                      kind: "custom",
                      ruleStepId: item.ruleStepId,
                      method: item.billingMethod,
                    })
                  }
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <span className="font-medium text-slate-800">
                    {item.profileName}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {scheduleDayLabel(item.scheduleDay)} ·{" "}
                    {SLOT_METHOD_LABELS[item.billingMethod]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="my-requests" className="space-y-2">
        <h3 id="my-requests" className="text-base font-semibold text-slate-900">
          Meus pedidos
        </h3>
        {requests.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nenhum pedido de template personalizado.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {requests.map((request) => (
              <li key={request.id} className="space-y-1 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-slate-500">
                    {new Date(request.createdAt).toLocaleDateString("pt-BR")}
                    {request.purpose
                      ? ` · ${MOMENT_LABELS[request.purpose]}`
                      : ""}
                    {request.billingMethod
                      ? ` · ${SLOT_METHOD_LABELS[request.billingMethod]}`
                      : ""}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONES[request.status]}`}
                  >
                    {REQUEST_STATUS_LABELS[request.status]}
                  </span>
                </div>
                <p className="line-clamp-2 text-slate-700">{request.message}</p>
                {request.adminNote && (
                  <p className="text-xs text-slate-500">
                    Resposta: {request.adminNote}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <TemplateRequestDialog
        open={requesting}
        onClose={() => setRequesting(false)}
        purpose={selection.kind === "moment" ? selection.purpose : null}
        billingMethod={selection.method}
        onCreated={(created) => setRequests((current) => [created, ...current])}
      />
    </div>
  );
}
