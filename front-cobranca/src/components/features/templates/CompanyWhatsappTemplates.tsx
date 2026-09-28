"use client";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { ApiClient } from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";
import {
  PURPOSE_LABELS,
  errorText,
  type CompanyWhatsappTemplate,
  type TemplateRenderResult,
} from "./types";

/**
 * WhatsApp templates the company may use, read-only. The list comes only from the
 * company's own grants; there is no personalization, authoring or admin data here.
 */
export function CompanyWhatsappTemplates(): ReactNode {
  const api = useApiClient();
  // Every piece of state is tagged with the client (session) that produced it: after a
  // session or company switch the previous catalog is simply not shown.
  const [catalog, setCatalog] = useState<{
    api: ApiClient;
    items: CompanyWhatsappTemplate[] | null;
    nextCursor: string | null;
    error: string | null;
  } | null>(null);
  const [choice, setChoice] = useState<{ api: ApiClient; id: string } | null>(
    null,
  );
  const [preview, setPreview] = useState<{
    id: string;
    result: TemplateRenderResult;
  } | null>(null);

  const current = catalog?.api === api ? catalog : null;
  const items = current?.items ?? null;
  const selectedId =
    (choice?.api === api ? choice.id : null) ?? items?.[0]?.id ?? null;

  useEffect(() => {
    let active = true;
    api
      .getTemplates({ limit: 25 })
      .then((page) => {
        if (active)
          setCatalog({
            api,
            items: page.items,
            nextCursor: page.nextCursor,
            error: null,
          });
      })
      .catch((caught: unknown) => {
        if (active)
          setCatalog({
            api,
            items: null,
            nextCursor: null,
            error: errorText(caught, "Não foi possível carregar os templates."),
          });
      });
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    api
      .getTemplatePreview(selectedId)
      .then((result) => {
        if (active) setPreview({ id: selectedId, result });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, selectedId]);

  async function loadMore(): Promise<void> {
    if (!current?.nextCursor) return;
    try {
      const page = await api.getTemplates({
        cursor: current.nextCursor,
        limit: 25,
      });
      setCatalog({
        api,
        items: [...(current.items ?? []), ...page.items],
        nextCursor: page.nextCursor,
        error: null,
      });
    } catch (caught: unknown) {
      setCatalog({
        ...current,
        error: errorText(caught, "Não foi possível carregar os templates."),
      });
    }
  }

  const error = current?.error ?? null;
  const nextCursor = current?.nextCursor ?? null;
  const setSelectedId = (id: string) => setChoice({ api, id });

  if (error && !items)
    return (
      <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
        {error}
      </p>
    );
  if (!items) return <p className="text-sm text-slate-500">Carregando…</p>;
  if (items.length === 0)
    return (
      <p className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-600">
        Nenhum template liberado para sua empresa.
      </p>
    );

  const selected = items.find((item) => item.id === selectedId) ?? items[0]!;
  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <aside className="space-y-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={selected.id === item.id}
            onClick={() => setSelectedId(item.id)}
            className={`w-full rounded-xl border p-4 text-left ${selected.id === item.id ? "border-indigo-500 bg-indigo-50" : "bg-white"}`}
          >
            <span className="block font-medium text-slate-900">
              {item.name}
            </span>
            <span className="mt-1 block text-xs text-slate-500">
              {item.language}
              {item.defaultFor.length > 0 && " · padrão"}
            </span>
          </button>
        ))}
        {nextCursor && (
          <button
            type="button"
            className="w-full rounded-lg border px-3 py-2 text-sm"
            onClick={() => void loadMore()}
          >
            Carregar mais templates
          </button>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </aside>
      <section
        aria-label={`Template ${selected.name}`}
        className="space-y-4 rounded-2xl border bg-white p-5 shadow-sm"
      >
        <div className="rounded-xl bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Conteúdo aprovado
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
            {selected.content.body}
          </p>
          {selected.content.footer && (
            <p className="mt-2 text-xs text-slate-500">
              {selected.content.footer}
            </p>
          )}
          {selected.content.button && (
            <p className="mt-2 text-xs text-slate-500">
              Botão: {selected.content.button.label}
            </p>
          )}
          {selected.content.quickReplies?.length ? (
            <p className="mt-2 text-xs text-slate-500">
              Respostas rápidas: {selected.content.quickReplies.join(", ")}
            </p>
          ) : null}
        </div>
        {selected.defaultFor.length > 0 && (
          <p className="text-sm text-slate-600">
            Padrão para:{" "}
            {selected.defaultFor
              .map((purpose) => PURPOSE_LABELS[purpose])
              .join(", ")}
          </p>
        )}
        {preview?.id === selected.id && preview.result.ok && (
          <div
            aria-label="Prévia com dados fictícios"
            className="rounded-xl border p-4"
          >
            <p className="text-xs font-semibold text-slate-500">
              Prévia com dados fictícios
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm">
              {preview.result.body}
            </p>
          </div>
        )}
        <p className="text-xs text-slate-500">
          O conteúdo é aprovado pela Meta e as variáveis são preenchidas pela
          CifraMais com os dados de cada cobrança. Para usar outro template,
          fale com o suporte.
        </p>
      </section>
    </div>
  );
}
