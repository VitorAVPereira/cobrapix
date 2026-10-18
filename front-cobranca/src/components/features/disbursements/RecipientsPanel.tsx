"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import Papa from "papaparse";
import { useApiClient } from "@/lib/use-api-client";
import type {
  DisbursementRecipient,
  DisbursementRecipientInput,
  Page,
} from "@/lib/api-client";
import {
  ACCOUNT_TYPES,
  RECIPIENTS_CSV_TEMPLATE,
  downloadCsv,
  errorCode,
  importErrors,
  maskDocument,
  parseRecipientsCsv,
} from "@/lib/disbursements";

const PAGE_SIZE = 20;

type Editing = DisbursementRecipient | "new" | null;

function destination(recipient: DisbursementRecipient): string {
  if (recipient.pixKey) return `Chave Pix ${recipient.pixKey}`;
  const type =
    ACCOUNT_TYPES.find((option) => option.value === recipient.bankAccountType)
      ?.label ?? recipient.bankAccountType;
  return `Banco ${recipient.bankIspb} · ag. ${recipient.bankAgency} · conta ${recipient.bankAccount} (${type})`;
}

/** Collaborators of the session company: who can be paid and where. */
export function RecipientsPanel() {
  const api = useApiClient();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<DisbursementRecipient> | null>(null);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const [byBank, setByBank] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [importProblems, setImportProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(
    (signal?: AbortSignal) =>
      api.listDisbursementRecipients(
        { search: query, includeInactive, page, pageSize: PAGE_SIZE },
        signal,
      ),
    [api, query, includeInactive, page],
  );
  useEffect(() => {
    // A newer search discards the answer of an older one.
    const controller = new AbortController();
    load(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setLoadError("");
        setData(result);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setLoadError("Não foi possível carregar os colaboradores.");
      });
    return () => controller.abort();
  }, [load]);

  function open(target: Editing) {
    setEditing(target);
    setByBank(target !== "new" && !!target && !target.pixKey);
    setFormError("");
    setNotice("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || busy) return;
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    const input: DisbursementRecipientInput = {
      name: value("name"),
      document: value("document"),
      ...(byBank
        ? {
            pixKey: null,
            bankIspb: value("bankIspb"),
            bankAgency: value("bankAgency"),
            bankAccount: value("bankAccount"),
            bankAccountType: value("bankAccountType"),
          }
        : {
            pixKey: value("pixKey"),
            bankIspb: null,
            bankAgency: null,
            bankAccount: null,
            bankAccountType: null,
          }),
    };
    setBusy(true);
    setFormError("");
    try {
      if (editing === "new") await api.createDisbursementRecipient(input);
      else
        await api.updateDisbursementRecipient(editing.id, {
          ...input,
          expectedVersion: editing.version,
          active: form.has("active"),
        });
      setEditing(null);
      setNotice("Colaborador salvo.");
      setData(await load());
    } catch (e) {
      if (errorCode(e) === "VERSION_CHANGED") {
        setEditing(null);
        setData(await load().catch(() => data));
        setNotice("");
        setFormError(
          "O cadastro foi alterado por outra pessoa. A lista foi recarregada; abra de novo para editar.",
        );
      } else
        setFormError(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }

  function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportProblems([]);
    setNotice("");
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = parseRecipientsCsv(results.data);
        if (!rows.length) {
          setImportProblems(["A planilha não tem linhas para importar."]);
          return;
        }
        setBusy(true);
        api
          .importDisbursementRecipients(rows)
          .then(async (result) => {
            setNotice(
              `${result.created} colaborador(es) importado(s); ${result.skipped} já cadastrado(s) com os mesmos dados.`,
            );
            setData(await load());
          })
          .catch((e: unknown) => {
            const problems = importErrors((e as { data?: unknown }).data);
            setImportProblems(
              problems.length
                ? ["Nada foi importado. Corrija estas linhas:", ...problems]
                : [e instanceof Error ? e.message : "Não foi possível importar."],
            );
          })
          .finally(() => setBusy(false));
      },
      error: () =>
        setImportProblems([
          "Não foi possível ler o arquivo. Salve a planilha como CSV e tente de novo.",
        ]),
    });
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const current = editing && editing !== "new" ? editing : null;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQuery(search.trim());
          }}
        >
          <label className="text-sm">
            Buscar por nome ou documento
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mt-1 block rounded-lg border p-2"
            />
          </label>
          <button type="submit" className="self-end rounded-lg border px-3 py-2 text-sm">
            Buscar
          </button>
        </form>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => {
              setPage(1);
              setIncludeInactive(e.target.checked);
            }}
          />
          Mostrar desativados
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              downloadCsv(RECIPIENTS_CSV_TEMPLATE, "modelo_colaboradores.csv")
            }
            className="rounded-lg border px-3 py-2 text-sm"
          >
            Baixar modelo
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            Importar planilha
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            aria-label="Planilha de colaboradores"
            className="hidden"
            onChange={importFile}
          />
          <button
            type="button"
            onClick={() => open("new")}
            className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white"
          >
            Novo colaborador
          </button>
        </div>
      </div>
      {notice && (
        <p role="status" className="text-sm text-emerald-700">
          {notice}
        </p>
      )}
      {!!importProblems.length && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {importProblems.map((problem) => (
            <p key={problem}>{problem}</p>
          ))}
        </div>
      )}
      {formError && !editing && (
        <p role="alert" className="text-sm text-red-800">
          {formError}
        </p>
      )}
      {editing && (
        <form
          key={current ? `${current.id}:${current.version}` : "new"}
          onSubmit={(e) => void save(e)}
          aria-label={current ? "Editar colaborador" : "Novo colaborador"}
          className="space-y-3 rounded-xl border border-indigo-200 bg-white p-4 text-sm"
        >
          <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
            <label>
              Nome
              <input
                name="name"
                required
                maxLength={120}
                defaultValue={current?.name}
                className="mt-1 w-full rounded border p-2"
              />
            </label>
            <label>
              CPF ou CNPJ
              <input
                name="document"
                required
                defaultValue={current?.document}
                className="mt-1 w-full rounded border p-2"
              />
            </label>
            <div className="flex gap-4 sm:col-span-2">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={!byBank}
                  onChange={() => setByBank(false)}
                />
                Chave Pix
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={byBank}
                  onChange={() => setByBank(true)}
                />
                Dados bancários
              </label>
            </div>
            {byBank ? (
              <>
                <label>
                  ISPB do banco (8 dígitos)
                  <input
                    name="bankIspb"
                    required
                    defaultValue={current?.bankIspb ?? ""}
                    className="mt-1 w-full rounded border p-2"
                  />
                </label>
                <label>
                  Agência (sem dígito)
                  <input
                    name="bankAgency"
                    required
                    defaultValue={current?.bankAgency ?? ""}
                    className="mt-1 w-full rounded border p-2"
                  />
                </label>
                <label>
                  Conta (com dígito)
                  <input
                    name="bankAccount"
                    required
                    defaultValue={current?.bankAccount ?? ""}
                    className="mt-1 w-full rounded border p-2"
                  />
                </label>
                <label>
                  Tipo de conta
                  <select
                    name="bankAccountType"
                    required
                    defaultValue={current?.bankAccountType ?? "cacc"}
                    className="mt-1 w-full rounded border p-2"
                  >
                    {ACCOUNT_TYPES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <label className="sm:col-span-2">
                Chave Pix
                <input
                  name="pixKey"
                  required
                  placeholder="CPF, CNPJ, e-mail, +55 com DDD ou chave aleatória"
                  defaultValue={current?.pixKey ?? ""}
                  className="mt-1 w-full rounded border p-2"
                />
              </label>
            )}
            {current && (
              <label className="flex items-center gap-2 sm:col-span-2">
                <input
                  type="checkbox"
                  name="active"
                  defaultChecked={current.active}
                />
                Ativo (desativado não entra em lotes novos)
              </label>
            )}
          </fieldset>
          {formError && (
            <p role="alert" className="text-red-800">
              {formError}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-indigo-600 px-3 py-2 font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Salvando…" : "Salvar colaborador"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded-lg border px-3 py-2"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
      {loadError ? (
        <p role="alert" className="text-sm text-red-800">
          {loadError}
        </p>
      ) : !data ? (
        <p className="text-sm text-slate-500">Carregando colaboradores…</p>
      ) : !data.items.length ? (
        <p className="text-sm text-slate-500">
          {query
            ? "Nenhum colaborador encontrado para a busca."
            : "Nenhum colaborador cadastrado ainda."}
        </p>
      ) : (
        <>
          <ul className="divide-y rounded-xl border bg-white">
            {data.items.map((recipient) => (
              <li
                key={recipient.id}
                className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
              >
                <span>
                  <strong>{recipient.name}</strong> ·{" "}
                  {maskDocument(recipient.document)} · {destination(recipient)}
                  {!recipient.active && " · desativado"}
                </span>
                <button
                  type="button"
                  onClick={() => open(recipient)}
                  className="rounded border px-3 py-1"
                >
                  Editar
                </button>
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <div className="flex items-center gap-2 text-sm">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="rounded border px-3 py-1 disabled:opacity-50"
              >
                Anterior
              </button>
              <span>
                Página {page} de {pages}
              </span>
              <button
                type="button"
                disabled={page >= pages}
                onClick={() => setPage(page + 1)}
                className="rounded border px-3 py-1 disabled:opacity-50"
              >
                Próxima
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
