"use client";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useApiClient } from "@/lib/use-api-client";
import {
  SOURCE_LABELS,
  TEMPLATE_SOURCES,
  errorText,
  isConflict,
  type AdminWhatsappTemplate,
  type TemplateBinding,
  type TemplateMapping,
  type TemplateRenderResult,
  type TemplateSource,
} from "./types";

const LITERAL = "LITERAL";

function initialBody(
  template: AdminWhatsappTemplate,
): Record<string, TemplateBinding | undefined> {
  const body: Record<string, TemplateBinding | undefined> = {};
  for (const variable of template.variables)
    body[variable] = template.mapping?.body[variable];
  return body;
}

function fieldLabel(field: string): string {
  const variable = /^body\.([a-z0-9_]+)$/.exec(field)?.[1];
  if (variable) return `variável {{${variable}}}`;
  return SOURCE_LABELS[field as TemplateSource] ?? field;
}

/**
 * Variable mapping of one imported template. The approved content is read-only; each
 * variable ({{1}} or {{nome}}) is bound to a closed data source or a short fixed text,
 * and the preview uses fictitious values. Saving is tied to the revisions loaded.
 */
export function TemplateMappingEditor({
  templateId,
  onClose,
  onSaved,
}: {
  templateId: string;
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const api = useApiClient();
  const [template, setTemplate] = useState<AdminWhatsappTemplate | null>(null);
  const [body, setBody] = useState<Record<string, TemplateBinding | undefined>>(
    {},
  );
  const [preview, setPreview] = useState<TemplateRenderResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const loaded = await api.getAdminWhatsappTemplate(templateId);
    setTemplate(loaded);
    setBody(initialBody(loaded));
    setPreview(null);
  }, [api, templateId]);

  useEffect(() => {
    setTemplate(null);
    setError(null);
    setNotice(null);
    load().catch((caught: unknown) =>
      setError(errorText(caught, "Não foi possível carregar o template.")),
    );
  }, [load]);

  if (!template)
    return (
      <section
        aria-label="Configurar variáveis"
        className="rounded-xl border p-5"
      >
        {error ? (
          <p role="alert" className="text-red-800">
            {error}
          </p>
        ) : (
          <p className="text-slate-500">Carregando template…</p>
        )}
      </section>
    );

  const complete = template.variables.every((variable) => {
    const binding = body[variable];
    return binding && (binding.kind === "SOURCE" || binding.value.trim());
  });
  const mapping = (): TemplateMapping => ({
    body: Object.fromEntries(
      Object.entries(body).filter((entry): entry is [string, TemplateBinding] =>
        Boolean(entry[1]),
      ),
    ),
    ...(template.content.button
      ? {
          paymentButton: {
            index: template.content.button.index ?? 0,
            source: "PAYMENT_URL_SUFFIX",
          },
        }
      : {}),
    ...(template.content.pixButton
      ? {
          pixButton: {
            index: template.content.pixButton.index,
            source: "PIX_COPY_PASTE",
          },
        }
      : {}),
  });

  function change(
    variable: string,
    binding: TemplateBinding | undefined,
  ): void {
    // Any edit makes the displayed preview stale.
    setPreview(null);
    setNotice(null);
    setBody((current) => ({ ...current, [variable]: binding }));
  }

  async function runPreview(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setPreview(
        await api.previewWhatsappTemplate(template!.id, { mapping: mapping() }),
      );
    } catch (caught: unknown) {
      setError(errorText(caught, "Não foi possível gerar a prévia."));
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await api.saveWhatsappTemplateMapping(template!.id, {
        expectedProviderRevision: template!.providerRevision,
        expectedMappingRevision: template!.mappingRevision,
        mapping: mapping(),
      });
      await load();
      setNotice(`Variáveis salvas (revisão ${saved.mappingRevision}).`);
      onSaved();
    } catch (caught: unknown) {
      if (isConflict(caught)) {
        // Another admin or a provider change moved the revisions: show what is current
        // now instead of overwriting it.
        await load().catch(() => undefined);
        setError("A configuração mudou. Atualize a prévia.");
      } else setError(errorText(caught, "As variáveis não foram salvas."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Configurar variáveis"
      className="space-y-4 rounded-xl border border-indigo-200 bg-white p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Variáveis de {template.name}</h3>
          <p className="text-sm text-slate-600">
            {template.language} · revisão do conteúdo{" "}
            {template.providerRevision} · revisão das variáveis{" "}
            {template.mappingRevision || "nenhuma"}
            {template.parameterFormat === "NAMED" && " · variáveis com nome"}
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg border px-3 py-1 text-sm"
          onClick={onClose}
        >
          Fechar
        </button>
      </div>
      <div className="rounded-lg bg-slate-50 p-3 text-sm">
        <p className="text-xs font-medium text-slate-500">
          Conteúdo aprovado (somente leitura)
        </p>
        <p className="whitespace-pre-wrap">{template.content.body}</p>
        {template.content.footer && (
          <p className="mt-1 text-xs text-slate-500">
            {template.content.footer}
          </p>
        )}
      </div>
      {!template.supported ? (
        <p className="text-sm text-amber-800">
          <strong>Formato não suportado</strong>
          {template.supportReason ? ` (${template.supportReason})` : ""}.
        </p>
      ) : (
        <>
          {template.variables.length === 0 && (
            <p className="text-sm text-slate-600">
              Este template não tem variáveis no corpo.
            </p>
          )}
          {template.variables.map((variable) => {
            const binding = body[variable];
            const value = binding
              ? binding.kind === "SOURCE"
                ? binding.source
                : LITERAL
              : "";
            return (
              <div key={variable} className="space-y-1">
                <label className="block text-sm">
                  {`Variável {{${variable}}}`}
                  <select
                    className="mt-1 w-full rounded-lg border p-2"
                    value={value}
                    onChange={(event) => {
                      const next = event.target.value;
                      change(
                        variable,
                        next === ""
                          ? undefined
                          : next === LITERAL
                            ? { kind: "LITERAL", value: "" }
                            : {
                                kind: "SOURCE",
                                source: next as TemplateSource,
                              },
                      );
                    }}
                  >
                    <option value="">Selecione a fonte</option>
                    {TEMPLATE_SOURCES.map((source) => (
                      <option key={source} value={source}>
                        {SOURCE_LABELS[source]}
                      </option>
                    ))}
                    <option value={LITERAL}>Texto fixo</option>
                  </select>
                </label>
                {binding?.kind === "LITERAL" && (
                  <label className="block text-sm">
                    {`Texto fixo da variável {{${variable}}}`}
                    <input
                      className="mt-1 w-full rounded-lg border p-2"
                      maxLength={200}
                      value={binding.value}
                      onChange={(event) =>
                        change(variable, {
                          kind: "LITERAL",
                          value: event.target.value,
                        })
                      }
                    />
                  </label>
                )}
              </div>
            );
          })}
          {template.content.button && (
            <p className="text-sm text-slate-600">
              Botão “{template.content.button.label}”: completado com o link de
              pagamento da cobrança enviada.
            </p>
          )}
          {template.content.pixButton && (
            <p className="text-sm text-slate-600">
              Botão “{template.content.pixButton.label}”: copia o Pix copia e
              cola da cobrança enviada. Cobrança sem Pix fica pendente.
            </p>
          )}
          {template.content.quickReplies?.length ? (
            <p className="text-sm text-slate-600">
              Respostas rápidas enviadas como aprovadas:{" "}
              {template.content.quickReplies.join(", ")}.
            </p>
          ) : null}
          {preview && (
            <div aria-label="Prévia fictícia" className="rounded-lg border p-3">
              {preview.ok ? (
                <p className="whitespace-pre-wrap text-sm">{preview.body}</p>
              ) : (
                <p className="text-sm text-amber-800">
                  {preview.code === "VALUE_MISSING"
                    ? `Sem valor para ${fieldLabel(preview.field)}.`
                    : `Configuração inválida em ${fieldLabel(preview.field)}.`}
                </p>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !complete}
              className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
              onClick={() => void runPreview()}
            >
              Visualizar prévia
            </button>
            <button
              type="button"
              disabled={busy || !complete}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              onClick={() => void save()}
            >
              Salvar variáveis
            </button>
          </div>
        </>
      )}
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
    </section>
  );
}
