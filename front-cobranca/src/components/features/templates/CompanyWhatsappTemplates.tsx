"use client";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { ApiClient } from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";
import { ListPagination } from "@/components/ui/ListPagination";
import { SearchForm } from "@/components/ui/SearchForm";
import {
  PURPOSE_LABELS,
  errorText,
  type CompanyWhatsappTemplate,
  type TemplateRenderResult,
} from "./types";

const PAGE_SIZE = 10;

/**
 * WhatsApp templates the company may use, read-only. The list comes only from the
 * company's own grants; there is no personalization, authoring or admin data here.
 */
export function CompanyWhatsappTemplates(): ReactNode {
  const api = useApiClient();
  // Every piece of state is tagged with the client (session) that produced it: after a
  // session or company switch the previous catalog, search and pages are simply not used.
  const [query, setQuery] = useState<{
    api: ApiClient;
    search: string;
    // Server cursors of pages 2..n.
    cursors: string[];
  }>({ api, search: "", cursors: [] });
  const [catalog, setCatalog] = useState<{
    api: ApiClient;
    items: CompanyWhatsappTemplate[] | null;
    nextCursor: string | null;
    total: number;
    error: string | null;
  } | null>(null);
  const [choice, setChoice] = useState<{ api: ApiClient; id: string } | null>(
    null,
  );
  const [preview, setPreview] = useState<{
    id: string;
    result: TemplateRenderResult;
  } | null>(null);

  const { search, cursors } =
    query.api === api ? query : { search: "", cursors: [] as string[] };
  const cursor = cursors.at(-1);
  const current = catalog?.api === api ? catalog : null;
  const items = current?.items ?? null;
  const selected =
    items?.find((item) => choice?.api === api && item.id === choice.id) ??
    items?.[0] ??
    null;
  const selectedId = selected?.id ?? null;

  useEffect(() => {
    let active = true;
    api
      .getTemplates({ limit: PAGE_SIZE, search: search || undefined, cursor })
      .then((page) => {
        if (active)
          setCatalog({
            api,
            items: page.items,
            nextCursor: page.nextCursor,
            total: page.total,
            error: null,
          });
      })
      .catch((caught: unknown) => {
        if (active)
          // The page already shown stays; only the failure is added.
          setCatalog((previous) => ({
            api,
            items: previous?.api === api ? previous.items : null,
            nextCursor: previous?.api === api ? previous.nextCursor : null,
            total: previous?.api === api ? previous.total : 0,
            error: errorText(caught, "Não foi possível carregar os templates."),
          }));
      });
    return () => {
      active = false;
    };
  }, [api, search, cursor]);

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

  const error = current?.error ?? null;
  const nextCursor = current?.nextCursor ?? null;
  const total = current?.total ?? 0;
  const setSelectedId = (id: string) => setChoice({ api, id });

  let content: ReactNode;
  if (error && !items)
    content = (
      <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
        {error}
      </p>
    );
  else if (!items)
    content = <p className="text-sm text-slate-500">Carregando…</p>;
  else if (!selected)
    content = (
      <p className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-600">
        {search
          ? "Nenhum template encontrado com esse nome."
          : "Nenhum template liberado para sua empresa."}
      </p>
    );
  else
    content = (
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
          <ListPagination
            page={cursors.length + 1}
            pageSize={PAGE_SIZE}
            total={total}
            hasNext={Boolean(nextCursor)}
            label={["template", "templates"]}
            onPrevious={() =>
              setQuery({ api, search, cursors: cursors.slice(0, -1) })
            }
            onNext={() => {
              if (nextCursor)
                setQuery({ api, search, cursors: [...cursors, nextCursor] });
            }}
          />
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
            {selected.content.pixButton && (
              <p className="mt-2 text-xs text-slate-500">
                Botão: {selected.content.pixButton.label} (Pix da cobrança)
              </p>
            )}
            {selected.content.boletoButton && (
              <p className="mt-2 text-xs text-slate-500">
                Botão: {selected.content.boletoButton.label} (linha digitável
                da cobrança)
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

  return (
    <div className="space-y-4">
      <SearchForm
        label="Buscar template"
        placeholder="Buscar template por nome"
        onSearch={(term) => setQuery({ api, search: term, cursors: [] })}
      />
      {content}
    </div>
  );
}
