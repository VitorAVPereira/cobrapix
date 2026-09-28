"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useApiClient } from "@/lib/use-api-client";
import type { AdminClientAnalyticsRow } from "@/lib/api-client";
import {
  BLOCK_LABELS,
  PURPOSE_LABELS,
  errorText,
  isConflict,
  type AdminWhatsappTemplate,
  type CompanyTemplateAccess,
  type CompanyTemplateDefault,
  type TemplatePurpose,
} from "./types";

const COMPANY_PAGE_SIZE = 10;

type Company = Pick<AdminClientAnalyticsRow, "companyId" | "corporateName">;

/**
 * Per-company availability. Companies and the approved catalog are paged; every write
 * carries the version the admin saw, and a conflict reloads instead of overwriting.
 * Fixing availability never resumes blocked sends: those are reviewed separately.
 */
export function CompanyTemplateGrants(): ReactNode {
  const api = useApiClient();
  const [search, setSearch] = useState("");
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [companyPage, setCompanyPage] = useState(1);
  const [companyTotal, setCompanyTotal] = useState(0);
  const [company, setCompany] = useState<Company | null>(null);
  const [access, setAccess] = useState<CompanyTemplateAccess | null>(null);
  const [catalog, setCatalog] = useState<AdminWhatsappTemplate[]>([]);
  const [catalogCursor, setCatalogCursor] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<TemplatePurpose, string>>>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selected = useRef<string | null>(null);

  async function findCompanies(page: number): Promise<void> {
    setError(null);
    try {
      const result = await api.getAdminClientAnalytics({
        search: search.trim() || undefined,
        page,
        pageSize: COMPANY_PAGE_SIZE,
      });
      setCompanies(
        result.clients.map(({ companyId, corporateName }) => ({
          companyId,
          corporateName,
        })),
      );
      setCompanyPage(result.pagination.page);
      setCompanyTotal(result.pagination.total);
    } catch (caught: unknown) {
      setError(errorText(caught, "Não foi possível buscar empresas."));
    }
  }

  const loadAccess = useCallback(
    async (companyId: string): Promise<void> => {
      const result = await api.getCompanyWhatsappTemplates(companyId);
      // A late answer for a previously selected company is discarded.
      if (selected.current !== companyId) return;
      setAccess(result);
      setDrafts({});
    },
    [api],
  );

  const loadCatalog = useCallback(
    async (cursor?: string): Promise<void> => {
      const page = await api.getAdminWhatsappTemplates({
        status: "APPROVED",
        cursor,
        limit: 25,
      });
      setCatalog((current) => (cursor ? [...current, ...page.items] : page.items));
      setCatalogCursor(page.nextCursor);
    },
    [api],
  );

  useEffect(() => {
    if (!company) return;
    selected.current = company.companyId;
    setAccess(null);
    setError(null);
    setNotice(null);
    Promise.all([loadAccess(company.companyId), loadCatalog()]).catch(
      (caught: unknown) =>
        setError(errorText(caught, "Não foi possível carregar as liberações.")),
    );
  }, [company, loadAccess, loadCatalog]);

  async function write(
    operation: () => Promise<unknown>,
    success: string,
  ): Promise<void> {
    if (!company) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await operation();
      setNotice(success);
    } catch (caught: unknown) {
      setError(
        isConflict(caught)
          ? "Outro administrador alterou esta configuração. Os dados foram recarregados; revise antes de repetir."
          : errorText(caught, "A alteração não foi salva."),
      );
    } finally {
      await loadAccess(company.companyId).catch(() => undefined);
      setBusy(false);
    }
  }

  const grants = access?.grants ?? [];
  const enabled = grants.filter((grant) => grant.enabled);
  const grantOf = (templateId: string) =>
    grants.find((grant) => grant.templateId === templateId);
  const grantable = catalog.filter(
    (template) => !grantOf(template.id)?.enabled,
  );

  function defaultOptions(row: CompanyTemplateDefault) {
    const options = enabled
      .filter((grant) => grant.available.ready)
      .map((grant) => ({ id: grant.templateId, name: grant.templateName }));
    // The current default stays visible even if it became unavailable.
    if (row.templateId && !options.some((option) => option.id === row.templateId))
      options.push({
        id: row.templateId,
        name: `${row.templateName ?? row.templateId} (indisponível)`,
      });
    return options;
  }

  return (
    <section aria-labelledby="company-grants" className="space-y-4">
      <div>
        <h2 id="company-grants" className="text-xl font-semibold">
          Disponibilidade por empresa
        </h2>
        <p className="text-sm text-slate-600">
          Uma empresa só vê e usa os templates liberados aqui. Liberar, revogar
          ou trocar o padrão afeta os próximos envios que usam esse template ou
          a finalidade. Corrigir a disponibilidade não retoma envios já
          bloqueados: eles precisam de revisão em “Envios pendentes”.
        </p>
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void findCompanies(1);
        }}
      >
        <label className="text-sm">
          Buscar empresa
          <input
            className="ml-2 rounded-lg border p-2"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button type="submit" className="rounded-lg border px-3 py-2 text-sm">
          Buscar
        </button>
      </form>
      {companies && (
        <div className="space-y-2">
          {companies.length === 0 && (
            <p className="text-sm text-slate-500">Nenhuma empresa encontrada.</p>
          )}
          <ul className="flex flex-wrap gap-2">
            {companies.map((row) => (
              <li key={row.companyId}>
                <button
                  type="button"
                  aria-pressed={company?.companyId === row.companyId}
                  className="rounded-lg border px-3 py-1 text-sm aria-pressed:bg-indigo-50"
                  onClick={() => setCompany(row)}
                >
                  {row.corporateName}
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 text-sm">
            {companyPage > 1 && (
              <button
                type="button"
                className="rounded-lg border px-3 py-1"
                onClick={() => void findCompanies(companyPage - 1)}
              >
                Empresas anteriores
              </button>
            )}
            {companyPage * COMPANY_PAGE_SIZE < companyTotal && (
              <button
                type="button"
                className="rounded-lg border px-3 py-1"
                onClick={() => void findCompanies(companyPage + 1)}
              >
                Próximas empresas
              </button>
            )}
          </div>
        </div>
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
      {company && access && (
        <div className="space-y-6 rounded-xl border bg-white p-5">
          <h3 className="font-semibold">{company.corporateName}</h3>

          <div className="space-y-2">
            <h4 className="font-medium">Templates liberados</h4>
            {enabled.length === 0 && (
              <p className="text-sm text-slate-500">
                Nenhum template liberado para esta empresa.
              </p>
            )}
            {enabled.map((grant) => (
              <div
                key={grant.templateId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <div>
                  <p className="text-sm font-medium">
                    {grant.templateName} · {grant.language}
                  </p>
                  {!grant.available.ready && grant.available.code && (
                    <p className="text-xs text-amber-800">
                      Indisponível: {BLOCK_LABELS[grant.available.code]}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Revogar ${grant.templateName}`}
                  className="rounded-lg border border-red-300 px-3 py-1 text-sm text-red-700 disabled:opacity-50"
                  onClick={() =>
                    void write(
                      () =>
                        api.setCompanyWhatsappTemplateGrant(
                          company.companyId,
                          grant.templateId,
                          { enabled: false, expectedVersion: grant.version },
                        ),
                      "Liberação revogada. Envios que dependiam dela serão bloqueados.",
                    )
                  }
                >
                  Revogar
                </button>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <h4 className="font-medium">Catálogo aprovado</h4>
            {grantable.length === 0 && (
              <p className="text-sm text-slate-500">
                Nenhum outro template aprovado para liberar.
              </p>
            )}
            {grantable.map((template) => (
              <div
                key={template.id}
                aria-label={template.name}
                role="group"
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <div>
                  <p className="text-sm font-medium">
                    {template.name} · {template.language}
                  </p>
                  {!template.supported ? (
                    <p className="text-xs text-amber-800">
                      Formato não suportado
                    </p>
                  ) : (
                    !template.readiness.ready &&
                    template.readiness.code && (
                      <p className="text-xs text-amber-800">
                        {BLOCK_LABELS[template.readiness.code]}
                      </p>
                    )
                  )}
                </div>
                <button
                  type="button"
                  disabled={busy || !template.readiness.ready}
                  className="rounded-lg border px-3 py-1 text-sm disabled:opacity-50"
                  onClick={() =>
                    void write(
                      () =>
                        api.setCompanyWhatsappTemplateGrant(
                          company.companyId,
                          template.id,
                          {
                            enabled: true,
                            expectedVersion: grantOf(template.id)?.version ?? 0,
                          },
                        ),
                      `${template.name} liberado para ${company.corporateName}.`,
                    )
                  }
                >
                  Liberar para empresa
                </button>
              </div>
            ))}
            {catalogCursor && (
              <button
                type="button"
                className="rounded-lg border px-3 py-1 text-sm"
                onClick={() =>
                  void loadCatalog(catalogCursor).catch((caught: unknown) =>
                    setError(errorText(caught, "Falha ao carregar templates.")),
                  )
                }
              >
                Carregar mais templates
              </button>
            )}
          </div>

          <div className="space-y-2">
            <h4 className="font-medium">Padrão por finalidade</h4>
            <p className="text-xs text-slate-500">
              Etapas configuradas como “padrão da finalidade” usam este
              template. Só templates liberados e prontos podem ser escolhidos.
            </p>
            {access.defaults.map((row) => {
              const label = PURPOSE_LABELS[row.purpose];
              const draft = drafts[row.purpose] ?? row.templateId ?? "";
              return (
                <div
                  key={row.purpose}
                  className="flex flex-wrap items-end gap-2 rounded-lg border p-3"
                >
                  <label className="text-sm">
                    {label}
                    <select
                      className="ml-2 rounded-lg border p-2"
                      value={draft}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [row.purpose]: event.target.value,
                        }))
                      }
                    >
                      <option value="">Sem padrão</option>
                      {defaultOptions(row).map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    aria-label={`Salvar padrão: ${label}`}
                    disabled={busy || draft === (row.templateId ?? "")}
                    className="rounded-lg border px-3 py-1 text-sm disabled:opacity-50"
                    onClick={() =>
                      void write(
                        () =>
                          api.setCompanyWhatsappTemplateDefault(
                            company.companyId,
                            row.purpose,
                            {
                              templateId: draft || null,
                              expectedVersion: row.version,
                            },
                          ),
                        `Padrão de “${label}” atualizado.`,
                      )
                    }
                  >
                    Salvar
                  </button>
                  {row.templateId && !row.available.ready && row.available.code && (
                    <p className="w-full text-xs text-amber-800">
                      O padrão atual está indisponível:{" "}
                      {BLOCK_LABELS[row.available.code]}. Envios dessa
                      finalidade ficarão pendentes.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
