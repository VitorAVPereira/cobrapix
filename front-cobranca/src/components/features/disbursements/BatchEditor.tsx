"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import Papa from "papaparse";
import { useApiClient } from "@/lib/use-api-client";
import type { DisbursementBatch, DisbursementRecipient } from "@/lib/api-client";
import {
  BATCH_CSV_TEMPLATE,
  downloadCsv,
  errorCode,
  formatCents,
  maskDocument,
  parseAmountToCents,
  parseBatchCsv,
} from "@/lib/disbursements";

const MAX_ITEMS = 500;

/**
 * Draft of a batch: reference and the net amount of each collaborator (blank = not in the
 * batch). Saving a draft never pays anyone; only the approval on WhatsApp does.
 */
export function BatchEditor({
  batch,
  onSaved,
  onCancel,
}: {
  batch?: DisbursementBatch;
  onSaved: (batch: DisbursementBatch) => void;
  onCancel: () => void;
}) {
  const api = useApiClient();
  const [recipients, setRecipients] = useState<DisbursementRecipient[] | null>(
    null,
  );
  const [loadError, setLoadError] = useState("");
  const [reference, setReference] = useState(batch?.reference ?? "");
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (batch?.items ?? []).map((item) => [
        item.recipientId,
        (item.amountCents / 100).toFixed(2).replace(".", ","),
      ]),
    ),
  );
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let current = true;
    (async () => {
      const all: DisbursementRecipient[] = [];
      for (let page = 1; ; page++) {
        const result = await api.listDisbursementRecipients({
          page,
          pageSize: 100,
        });
        all.push(...result.items);
        if (all.length >= result.total || !result.items.length) break;
      }
      return all;
    })()
      .then((all) => {
        if (current) setRecipients(all);
      })
      .catch(() => {
        if (current) setLoadError("Não foi possível carregar os colaboradores.");
      });
    return () => {
      current = false;
    };
  }, [api]);

  const items = useMemo(
    () =>
      Object.entries(amounts)
        .filter(([, value]) => value.trim())
        .map(([recipientId, value]) => ({
          recipientId,
          amountCents: parseAmountToCents(value),
        })),
    [amounts],
  );
  const invalid = items.some((item) => item.amountCents === null);
  const total = items.reduce((sum, item) => sum + (item.amountCents ?? 0), 0);

  function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !recipients) return;
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const byDocument = new Map(
          recipients.map((recipient) => [recipient.document, recipient]),
        );
        const parsed = parseBatchCsv(results.data, byDocument);
        setProblems(parsed.errors);
        if (parsed.errors.length) return;
        setAmounts(
          Object.fromEntries(
            parsed.items.map((item) => [
              item.recipientId,
              (item.amountCents / 100).toFixed(2).replace(".", ","),
            ]),
          ),
        );
      },
      error: () =>
        setProblems([
          "Não foi possível ler o arquivo. Salve a planilha como CSV e tente de novo.",
        ]),
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || invalid || !items.length) return;
    const body = {
      reference: reference.trim(),
      items: items.map((item) => ({
        recipientId: item.recipientId,
        amountCents: item.amountCents!,
      })),
    };
    setBusy(true);
    setError("");
    try {
      onSaved(
        batch
          ? await api.updateDisbursementBatch(batch.id, {
              ...body,
              expectedVersion: batch.version,
            })
          : await api.createDisbursementBatch(body),
      );
    } catch (e) {
      setError(
        errorCode(e) === "VERSION_CHANGED"
          ? "O lote foi alterado por outra pessoa. Feche e abra de novo para ver a versão atual."
          : e instanceof Error
            ? e.message
            : "Não foi possível salvar o lote.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loadError)
    return (
      <p role="alert" className="text-sm text-red-800">
        {loadError}
      </p>
    );
  if (!recipients)
    return <p className="text-sm text-slate-500">Carregando colaboradores…</p>;
  return (
    <form
      onSubmit={(e) => void save(e)}
      aria-label={batch ? "Editar lote" : "Novo lote"}
      className="space-y-4 rounded-xl border border-indigo-200 bg-white p-4 text-sm"
    >
      <fieldset disabled={busy} className="space-y-4">
        <label className="block">
          Referência do lote
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            required
            minLength={2}
            maxLength={80}
            placeholder="Folha 10/2026"
            className="mt-1 w-full rounded border p-2"
          />
        </label>
        {!recipients.length ? (
          <p className="text-slate-500">
            Cadastre os colaboradores antes de montar um lote.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => downloadCsv(BATCH_CSV_TEMPLATE, "modelo_lote.csv")}
                className="rounded-lg border px-3 py-2"
              >
                Baixar modelo
              </button>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="rounded-lg border px-3 py-2"
              >
                Preencher por planilha
              </button>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv"
                aria-label="Planilha do lote"
                className="hidden"
                onChange={importFile}
              />
            </div>
            {!!problems.length && (
              <div role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
                <p>Nada foi preenchido. Corrija estas linhas:</p>
                {problems.map((problem) => (
                  <p key={problem}>{problem}</p>
                ))}
              </div>
            )}
            <div className="max-h-[28rem] overflow-y-auto rounded-lg border">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    <th className="p-2">Colaborador</th>
                    <th className="p-2">Valor líquido (R$)</th>
                  </tr>
                </thead>
                <tbody>
                  {recipients.map((recipient) => (
                    <tr key={recipient.id} className="border-t">
                      <td className="p-2">
                        {recipient.name} · {maskDocument(recipient.document)}
                      </td>
                      <td className="p-2">
                        <input
                          aria-label={`Valor de ${recipient.name}`}
                          inputMode="decimal"
                          value={amounts[recipient.id] ?? ""}
                          onChange={(e) =>
                            setAmounts({
                              ...amounts,
                              [recipient.id]: e.target.value,
                            })
                          }
                          placeholder="fora do lote"
                          className="w-36 rounded border p-1"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p>
          {items.length} pagamento(s) · total {formatCents(total)}
          {invalid && (
            <span className="ml-2 text-red-800">
              Há valores inválidos: use, por exemplo, 1500,00.
            </span>
          )}
          {items.length > MAX_ITEMS && (
            <span className="ml-2 text-red-800">
              Um lote aceita até {MAX_ITEMS} pagamentos.
            </span>
          )}
        </p>
      </fieldset>
      {error && (
        <p role="alert" className="text-red-800">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || invalid || !items.length || items.length > MAX_ITEMS}
          className="rounded-lg bg-indigo-600 px-3 py-2 font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Salvando…" : "Salvar rascunho"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border px-3 py-2"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
