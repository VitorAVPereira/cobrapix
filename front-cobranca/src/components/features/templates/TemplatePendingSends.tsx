"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useApiClient } from "@/lib/use-api-client";
import { TemplateResumeReview } from "./TemplateResumeReview";
import {
  BLOCK_LABELS,
  ORIGIN_LABELS,
  PENDING_STATE_LABELS,
  errorText,
  resumeReasonLabel,
  type PendingState,
  type ResumeReview,
  type TemplateBlockCode,
  type TemplatePendingQuery,
  type TemplatePendingSend,
} from "./types";

const MAX_SELECTION = 50;

type Option = { id: string; name: string };

function formatDate(value: string): string {
  return new Date(value).toLocaleString("pt-BR");
}

/**
 * Held WhatsApp sends. The company sees only its own reasons and states; the platform
 * admin filters across companies, picks holds explicitly (nothing is preselected),
 * optionally swaps the template for a granted one, previews and then confirms.
 */
export function TemplatePendingSends({
  scope,
}: {
  scope: "ADMIN" | "COMPANY";
}): ReactNode {
  const api = useApiClient();
  const admin = scope === "ADMIN";
  const [state, setState] = useState<PendingState>("BLOCKED");
  const [code, setCode] = useState<TemplateBlockCode | "">("");
  const [company, setCompany] = useState<Option | null>(null);
  const [template, setTemplate] = useState<Option | null>(null);
  const [items, setItems] = useState<TemplatePendingSend[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const [granted, setGranted] = useState<Record<string, Option[]>>({});
  const [review, setReview] = useState<ResumeReview | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  const load = useCallback(
    async (cursor?: string): Promise<void> => {
      const id = ++request.current;
      const query: TemplatePendingQuery = {
        state,
        cursor,
        limit: 25,
        ...(code ? { code } : {}),
        ...(admin && company ? { companyId: company.id } : {}),
        ...(admin && template ? { templateId: template.id } : {}),
      };
      try {
        const page = admin
          ? await api.getAdminTemplatePending(query)
          : await api.getCompanyTemplatePending({
              state,
              cursor,
              limit: 25,
            });
        if (id !== request.current) return;
        setItems((current) =>
          cursor ? [...(current ?? []), ...page.items] : page.items,
        );
        setNextCursor(page.nextCursor);
      } catch (caught: unknown) {
        if (id === request.current)
          setError(
            errorText(caught, "Não foi possível carregar as pendências."),
          );
      }
    },
    [admin, api, code, company, state, template],
  );

  useEffect(() => {
    void load();
  }, [load]);

  function resetSelection(): void {
    setSelected([]);
    setReplacements({});
    setReview(null);
    setError(null);
  }

  async function loadGranted(companyId: string): Promise<void> {
    if (granted[companyId]) return;
    try {
      const access = await api.getCompanyWhatsappTemplates(companyId);
      setGranted((current) => ({
        ...current,
        [companyId]: access.grants
          .filter((grant) => grant.enabled && grant.available.ready)
          .map((grant) => ({ id: grant.templateId, name: grant.templateName })),
      }));
    } catch {
      setGranted((current) => ({ ...current, [companyId]: [] }));
    }
  }

  function toggle(item: TemplatePendingSend): void {
    setReview(null);
    setSelected((current) =>
      current.includes(item.id)
        ? current.filter((id) => id !== item.id)
        : current.length >= MAX_SELECTION
          ? current
          : [...current, item.id],
    );
    if (item.companyId) void loadGranted(item.companyId);
  }

  async function preview(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setReview(
        await api.previewTemplateResume(
          selected.map((pendingId) => ({
            pendingId,
            ...(replacements[pendingId]
              ? { replacementTemplateId: replacements[pendingId] }
              : {}),
          })),
        ),
      );
    } catch (caught: unknown) {
      setError(errorText(caught, "Não foi possível revisar as pendências."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={`pending-${scope}`} className="space-y-4">
      <div>
        <h2 id={`pending-${scope}`} className="text-xl font-semibold">
          Envios pendentes de WhatsApp
        </h2>
        <p className="text-sm text-slate-600">
          {admin
            ? "Mensagens bloqueadas pela política de templates. Corrigir um template ou uma liberação não as retoma: selecione, revise a prévia e autorize."
            : "Mensagens da sua empresa que não foram enviadas porque o template não estava disponível. A CifraMais revisa e autoriza a retomada."}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Situação
          <select
            className="ml-2 rounded-lg border p-2"
            value={state}
            onChange={(event) => {
              resetSelection();
              setState(event.target.value as PendingState);
            }}
          >
            {(Object.keys(PENDING_STATE_LABELS) as PendingState[]).map(
              (value) => (
                <option key={value} value={value}>
                  {PENDING_STATE_LABELS[value]}
                </option>
              ),
            )}
          </select>
        </label>
        {admin && (
          <label className="text-sm">
            Motivo
            <select
              className="ml-2 rounded-lg border p-2"
              value={code}
              onChange={(event) => {
                resetSelection();
                setCode(event.target.value as TemplateBlockCode | "");
              }}
            >
              <option value="">Todos</option>
              {(Object.keys(BLOCK_LABELS) as TemplateBlockCode[]).map(
                (value) => (
                  <option key={value} value={value}>
                    {BLOCK_LABELS[value]}
                  </option>
                ),
              )}
            </select>
          </label>
        )}
        {company && (
          <button
            type="button"
            className="rounded-full border px-3 py-1 text-sm"
            onClick={() => {
              resetSelection();
              setCompany(null);
            }}
          >
            Empresa: {company.name} ✕
          </button>
        )}
        {template && (
          <button
            type="button"
            className="rounded-full border px-3 py-1 text-sm"
            onClick={() => {
              resetSelection();
              setTemplate(null);
            }}
          >
            Template: {template.name} ✕
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      {items && items.length === 0 && (
        <p className="text-sm text-slate-500">
          Nenhuma pendência nesta situação.
        </p>
      )}
      <ul className="space-y-2">
        {items?.map((item) => {
          const checked = selected.includes(item.id);
          const options = item.companyId ? granted[item.companyId] : undefined;
          return (
            <li
              key={item.id}
              className="rounded-lg border bg-white p-3 text-sm"
            >
              <div className="flex flex-wrap items-start gap-3">
                {admin && item.state === "BLOCKED" && (
                  <input
                    type="checkbox"
                    aria-label={`Selecionar pendência de ${item.companyName ?? "empresa"} (${BLOCK_LABELS[item.code]})`}
                    checked={checked}
                    onChange={() => toggle(item)}
                  />
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-medium">{BLOCK_LABELS[item.code]}</p>
                  <p className="text-xs text-slate-600">
                    {ORIGIN_LABELS[item.origin]} · desde{" "}
                    {formatDate(item.blockedAt)}
                    {item.occurrences > 1 &&
                      ` · ${item.occurrences} tentativas`}
                    {` · ${PENDING_STATE_LABELS[item.state]}`}
                  </p>
                  {item.closedReason && (
                    <p className="text-xs text-slate-500">
                      {resumeReasonLabel(item.closedReason)}
                    </p>
                  )}
                  {admin && (
                    <p className="flex flex-wrap gap-2 text-xs">
                      {item.companyId && (
                        <button
                          type="button"
                          className="underline"
                          onClick={() => {
                            resetSelection();
                            setCompany({
                              id: item.companyId!,
                              name: item.companyName ?? item.companyId!,
                            });
                          }}
                        >
                          {item.companyName}
                        </button>
                      )}
                      {item.templateId && (
                        <button
                          type="button"
                          className="underline"
                          onClick={() => {
                            resetSelection();
                            setTemplate({
                              id: item.templateId!,
                              name: item.templateName ?? item.templateId!,
                            });
                          }}
                        >
                          {item.templateName ?? "template"}
                        </button>
                      )}
                    </p>
                  )}
                  {admin && checked && options && (
                    <label className="block text-xs">
                      Template na retomada
                      <select
                        className="ml-2 rounded border p-1"
                        value={replacements[item.id] ?? ""}
                        onChange={(event) => {
                          setReview(null);
                          setReplacements((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }));
                        }}
                      >
                        <option value="">Manter a escolha atual</option>
                        {options.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {nextCursor && (
        <button
          type="button"
          className="rounded-lg border px-3 py-1 text-sm"
          onClick={() => void load(nextCursor)}
        >
          Carregar mais pendências
        </button>
      )}
      {admin && selected.length > 0 && !review && (
        <button
          type="button"
          disabled={busy}
          className="rounded-lg border border-indigo-600 px-4 py-2 text-sm font-semibold text-indigo-700 disabled:opacity-50"
          onClick={() => void preview()}
        >
          Revisar retomada ({selected.length})
        </button>
      )}
      {admin && review && (
        <TemplateResumeReview
          key={review.id}
          review={review}
          onConfirmed={() => {
            setSelected([]);
            setReplacements({});
            void load();
          }}
          onInvalidated={() => void load()}
          onCancel={() => setReview(null)}
        />
      )}
    </section>
  );
}
