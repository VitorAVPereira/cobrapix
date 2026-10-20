"use client";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useApiClient } from "@/lib/use-api-client";
import {
  COLLECTION_SLOT_METHODS,
  MOMENT_LABELS,
  REQUEST_STATUS_LABELS,
  SLOT_METHOD_LABELS,
  errorText,
  isConflict,
  scheduleDayLabel,
  type CollectionSlotMethod,
  type CollectionTemplateSlots,
  type CompanyCollectionStep,
  type TemplateRequest,
  type TemplateRequestStatus,
} from "./types";

const STATUSES = Object.keys(REQUEST_STATUS_LABELS) as TemplateRequestStatus[];

/** Links a custom template to one WhatsApp step of the requesting company. */
function CustomTemplateLinker({
  request,
}: {
  request: TemplateRequest;
}): ReactNode {
  const api = useApiClient();
  const [steps, setSteps] = useState<CompanyCollectionStep[] | null>(null);
  const [options, setOptions] = useState<
    CollectionTemplateSlots["options"] | null
  >(null);
  const [stepId, setStepId] = useState(request.ruleStepId ?? "");
  const [method, setMethod] = useState<CollectionSlotMethod>(
    request.billingMethod ?? "PIX",
  );
  const [templateId, setTemplateId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    Promise.all([
      api.getCompanyCollectionSteps(request.companyId!),
      api.getCollectionTemplateSlots(),
    ])
      .then(([companySteps, slots]) => {
        if (!active) return;
        setSteps(companySteps);
        setOptions(slots.options);
      })
      .catch((caught: unknown) => {
        if (active)
          setMessage({
            ok: false,
            text: errorText(caught, "Não foi possível carregar as etapas."),
          });
      });
    return () => {
      active = false;
    };
  }, [api, request.companyId]);

  const step = steps?.find((item) => item.ruleStepId === stepId);
  const current = step?.customTemplates.find(
    (item) => item.billingMethod === method,
  );

  async function save(next: string | null): Promise<void> {
    if (!stepId) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.setCompanyCollectionStepTemplate(
        request.companyId!,
        stepId,
        method,
        next,
      );
      setSteps(await api.getCompanyCollectionSteps(request.companyId!));
      setMessage({
        ok: true,
        text: next
          ? "Template sob medida ligado à etapa."
          : "Template sob medida removido: a etapa volta ao template da régua.",
      });
    } catch (caught: unknown) {
      setMessage({
        ok: false,
        text: errorText(caught, "A alteração não foi salva."),
      });
    } finally {
      setBusy(false);
    }
  }

  if (!steps || !options)
    return message ? (
      <p role="alert" className="text-sm text-red-700">
        {message.text}
      </p>
    ) : (
      <p className="text-sm text-slate-500">Carregando etapas da empresa...</p>
    );

  return (
    <div className="space-y-2 rounded-md bg-slate-50 p-3">
      {steps.length === 0 ? (
        <p className="text-sm text-slate-500">
          A empresa não tem etapas de WhatsApp na régua.
        </p>
      ) : (
        <div className="grid gap-2 md:grid-cols-3">
          <label className="text-sm">
            Etapa
            <select
              className="mt-1 block w-full rounded-lg border p-2 text-sm"
              value={stepId}
              onChange={(event) => setStepId(event.target.value)}
            >
              <option value="">Escolha a etapa</option>
              {steps.map((item) => (
                <option key={item.ruleStepId} value={item.ruleStepId}>
                  {item.profileName} · {scheduleDayLabel(item.scheduleDay)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Forma de pagamento
            <select
              className="mt-1 block w-full rounded-lg border p-2 text-sm"
              value={method}
              onChange={(event) =>
                setMethod(event.target.value as CollectionSlotMethod)
              }
            >
              {COLLECTION_SLOT_METHODS.map((item) => (
                <option key={item} value={item}>
                  {SLOT_METHOD_LABELS[item]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Template
            <select
              className="mt-1 block w-full rounded-lg border p-2 text-sm"
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
            >
              <option value="">Escolha o template</option>
              {options[method].map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {current && (
        <p className="text-xs text-slate-600">
          Em uso nesta etapa: {current.templateName}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !stepId || !templateId}
          onClick={() => void save(templateId)}
          className="rounded-lg border px-3 py-1 text-sm disabled:opacity-50"
        >
          Ligar à etapa
        </button>
        {current && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void save(null)}
            className="rounded-lg border border-red-300 px-3 py-1 text-sm text-red-700 disabled:opacity-50"
          >
            Remover template sob medida
          </button>
        )}
      </div>
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-700"}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

/**
 * Support requests for custom templates. Status changes carry the version the admin saw;
 * a conflict reloads the list instead of overwriting.
 */
export function TemplateRequestsAdmin(): ReactNode {
  const api = useApiClient();
  const [status, setStatus] = useState<TemplateRequestStatus | "">("OPEN");
  const [requests, setRequests] = useState<TemplateRequest[] | null>(null);
  const [drafts, setDrafts] = useState<
    Record<string, { status: TemplateRequestStatus; note: string }>
  >({});
  const [linking, setLinking] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .getAdminTemplateRequests(status || undefined)
      .then((rows) => {
        if (!active) return;
        setRequests(rows);
        setDrafts({});
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            errorText(caught, "Não foi possível carregar as solicitações."),
          );
      });
    return () => {
      active = false;
    };
  }, [api, status, reloadKey]);

  async function save(request: TemplateRequest): Promise<void> {
    const draft = drafts[request.id];
    if (!draft) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.updateTemplateRequest(request.id, {
        status: draft.status,
        adminNote: draft.note,
        expectedVersion: request.version,
      });
      setNotice("Solicitação atualizada.");
    } catch (caught: unknown) {
      setError(
        isConflict(caught)
          ? "Outro administrador alterou esta solicitação. A lista foi recarregada."
          : errorText(caught, "A alteração não foi salva."),
      );
    } finally {
      setReloadKey((key) => key + 1);
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="template-requests" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="template-requests" className="text-xl font-semibold">
            Solicitações de template
          </h2>
          <p className="text-sm text-slate-600">
            Pedidos das empresas por um template personalizado. Depois de
            aprovado na Meta e mapeado, ligue o template à etapa da empresa.
          </p>
        </div>
        <label className="text-sm">
          Situação
          <select
            className="ml-2 rounded-lg border p-2"
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as TemplateRequestStatus | "")
            }
          >
            <option value="">Todas</option>
            {STATUSES.map((item) => (
              <option key={item} value={item}>
                {REQUEST_STATUS_LABELS[item]}
              </option>
            ))}
          </select>
        </label>
      </div>
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
      {!requests ? (
        !error && (
          <p className="text-sm text-slate-500">Carregando solicitações...</p>
        )
      ) : requests.length === 0 ? (
        <p className="text-sm text-slate-500">
          Nenhuma solicitação nesta situação.
        </p>
      ) : (
        <ul className="space-y-3">
          {requests.map((request) => {
            const draft = drafts[request.id] ?? {
              status: request.status,
              note: request.adminNote ?? "",
            };
            const changed =
              draft.status !== request.status ||
              draft.note !== (request.adminNote ?? "");
            return (
              <li
                key={request.id}
                className="space-y-3 rounded-xl border bg-white p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">{request.companyName}</p>
                  <p className="text-xs text-slate-500">
                    {new Date(request.createdAt).toLocaleString("pt-BR")}
                    {request.purpose
                      ? ` · ${MOMENT_LABELS[request.purpose]}`
                      : ""}
                    {request.billingMethod
                      ? ` · ${SLOT_METHOD_LABELS[request.billingMethod]}`
                      : ""}
                  </p>
                </div>
                <p className="whitespace-pre-line text-sm text-slate-700">
                  {request.message}
                </p>
                <div className="grid gap-2 md:grid-cols-[12rem_minmax(0,1fr)_auto] md:items-end">
                  <label className="text-sm">
                    Situação
                    <select
                      aria-label={`Situação do pedido de ${request.companyName}`}
                      className="mt-1 block w-full rounded-lg border p-2 text-sm"
                      value={draft.status}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [request.id]: {
                            ...draft,
                            status: event.target.value as TemplateRequestStatus,
                          },
                        }))
                      }
                    >
                      {STATUSES.map((item) => (
                        <option key={item} value={item}>
                          {REQUEST_STATUS_LABELS[item]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    Resposta para a empresa
                    <input
                      className="mt-1 block w-full rounded-lg border p-2 text-sm"
                      maxLength={1000}
                      value={draft.note}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [request.id]: { ...draft, note: event.target.value },
                        }))
                      }
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy || !changed}
                    onClick={() => void save(request)}
                    className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
                  >
                    Salvar
                  </button>
                </div>
                <button
                  type="button"
                  aria-expanded={linking === request.id}
                  onClick={() =>
                    setLinking((current) =>
                      current === request.id ? null : request.id,
                    )
                  }
                  className="text-sm font-medium text-emerald-700 underline"
                >
                  Ligar template sob medida
                </button>
                {linking === request.id && (
                  <CustomTemplateLinker request={request} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
