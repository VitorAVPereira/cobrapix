"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import Papa from "papaparse";
import { CalendarClock, FileSpreadsheet, Loader2, Repeat, Search, Send } from "lucide-react";
import { useApiClient } from "@/lib/use-api-client";
import type {
  DisbursementBatch,
  DisbursementRecipient,
  DisbursementScheduleUnit,
  DisbursementStatus,
} from "@/lib/api-client";
import {
  BATCH_CSV_TEMPLATE,
  downloadCsv,
  errorCode,
  formatCents,
  formatDate,
  hoursLeftToday,
  maskDocument,
  parseAmountToCents,
  parseBatchCsv,
  repeatEndLabel,
  repeatLabel,
  saoPauloToday,
} from "@/lib/disbursements";

const MAX_ITEMS = 500;
const fieldBase =
  "h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50 disabled:text-slate-400";
const fieldClass = `${fieldBase} w-full`;

type RepeatEnd = "never" | "date" | "count";

function amountText(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/**
 * One screen for the whole payment: what, when (optionally repeating) and to whom.
 * Saving never pays anyone; only the approver's confirmation on WhatsApp does.
 */
export function BatchEditor({
  batch,
  status,
  onSaved,
  onCancel,
}: {
  batch?: DisbursementBatch;
  status: DisbursementStatus;
  onSaved: (batch: DisbursementBatch) => void;
  onCancel: () => void;
}) {
  const api = useApiClient();
  const today = saoPauloToday();
  const [recipients, setRecipients] = useState<DisbursementRecipient[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reference, setReference] = useState(batch?.reference ?? "");
  const [date, setDate] = useState(
    batch?.scheduledFor && batch.scheduledFor >= today ? batch.scheduledFor : today,
  );
  const [repeat, setRepeat] = useState(false);
  const [every, setEvery] = useState("1");
  const [unit, setUnit] = useState<DisbursementScheduleUnit>("MONTH");
  const [repeatEnd, setRepeatEnd] = useState<RepeatEnd>("never");
  const [endsOn, setEndsOn] = useState("");
  const [occurrences, setOccurrences] = useState("12");
  const [applyToSchedule, setApplyToSchedule] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (batch?.items ?? []).map((item) => [item.recipientId, amountText(item.amountCents)]),
    ),
  );
  const [search, setSearch] = useState("");
  const [onlySelected, setOnlySelected] = useState(Boolean(batch));
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let current = true;
    (async () => {
      const all: DisbursementRecipient[] = [];
      for (let page = 1; ; page++) {
        const result = await api.listDisbursementRecipients({ page, pageSize: 100 });
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
        .map(([recipientId, value]) => ({ recipientId, amountCents: parseAmountToCents(value) })),
    [amounts],
  );
  const invalid = items.some((item) => item.amountCents === null);
  const total = items.reduce((sum, item) => sum + (item.amountCents ?? 0), 0);
  const isToday = date === today;
  const approver = status.approverName ?? "o responsável";

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const digits = term.replace(/\D/g, "");
    return (recipients ?? []).filter((recipient) => {
      if (onlySelected && !amounts[recipient.id]?.trim()) return false;
      if (!term) return true;
      return (
        recipient.name.toLowerCase().includes(term) ||
        (digits.length > 0 && recipient.document.includes(digits))
      );
    });
  }, [amounts, onlySelected, recipients, search]);

  const repeatProblem = !repeat
    ? ""
    : !(Number.isInteger(Number(every)) && Number(every) >= 1 && Number(every) <= 366)
      ? "Informe de quanto em quanto tempo repetir (1 a 366)."
      : repeatEnd === "date" && (!endsOn || endsOn <= date)
        ? "A data final deve ser depois do primeiro pagamento."
        : repeatEnd === "count" &&
            !(Number.isInteger(Number(occurrences)) && Number(occurrences) >= 2 && Number(occurrences) <= 500)
          ? "Informe quantas vezes pagar (2 a 500)."
          : "";

  function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !recipients) return;
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const byDocument = new Map(recipients.map((recipient) => [recipient.document, recipient]));
        const parsed = parseBatchCsv(results.data, byDocument);
        setProblems(parsed.errors);
        if (parsed.errors.length) return;
        setAmounts(
          Object.fromEntries(parsed.items.map((item) => [item.recipientId, amountText(item.amountCents)])),
        );
        setOnlySelected(true);
      },
      error: () =>
        setProblems(["Não foi possível ler o arquivo. Salve a planilha como CSV e tente de novo."]),
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || invalid || !items.length || repeatProblem) return;
    const body = {
      reference: reference.trim(),
      items: items.map((item) => ({ recipientId: item.recipientId, amountCents: item.amountCents! })),
      scheduledFor: date,
    };
    setBusy(true);
    setError("");
    try {
      onSaved(
        batch
          ? await api.updateDisbursementBatch(batch.id, {
              ...body,
              expectedVersion: batch.version,
              ...(batch.schedule?.status === "ACTIVE" ? { applyToSchedule } : {}),
            })
          : await api.createDisbursementBatch({
              ...body,
              ...(repeat
                ? {
                    repeat: {
                      unit,
                      every: Number(every),
                      ...(repeatEnd === "date" ? { endsOn } : {}),
                      ...(repeatEnd === "count" ? { occurrences: Number(occurrences) } : {}),
                    },
                  }
                : {}),
            }),
      );
    } catch (e) {
      setError(
        errorCode(e) === "VERSION_CHANGED"
          ? "O pagamento foi alterado por outra pessoa. Feche e abra de novo para ver a versão atual."
          : e instanceof Error
            ? e.message
            : "Não foi possível salvar o pagamento.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loadError)
    return (
      <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
        {loadError}
      </p>
    );
  if (!recipients)
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 size={16} className="animate-spin" /> Carregando colaboradores…
      </p>
    );

  const sectionClass = "space-y-3 rounded-md border border-slate-200 bg-white p-4";
  const stepClass =
    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-semibold text-white";

  return (
    <form
      onSubmit={(e) => void save(e)}
      aria-label={batch ? "Editar pagamento" : "Novo pagamento"}
      className="space-y-4 text-sm"
    >
      <fieldset disabled={busy} className="space-y-4">
        <section className={sectionClass}>
          <h3 className="flex items-center gap-2 font-semibold text-slate-900">
            <span className={stepClass}>1</span> O que é este pagamento
          </h3>
          <label className="block text-slate-600">
            Descrição
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              required
              minLength={2}
              maxLength={80}
              placeholder="Ex.: Folha de novembro"
              className={`${fieldClass} mt-1`}
            />
          </label>
        </section>

        <section className={sectionClass}>
          <h3 className="flex items-center gap-2 font-semibold text-slate-900">
            <span className={stepClass}>2</span> Quando pagar
          </h3>
          <label className="block max-w-xs text-slate-600">
            Data do pagamento
            <input
              type="date"
              value={date}
              min={today}
              required
              onChange={(e) => setDate(e.target.value)}
              className={`${fieldClass} mt-1`}
            />
          </label>
          {batch?.schedule ? (
            <div className="space-y-2 rounded-md bg-slate-50 p-3 text-slate-600">
              <p className="flex items-center gap-2">
                <Repeat size={15} className="text-slate-400" />
                Este pagamento se repete {repeatLabel(batch.schedule.unit, batch.schedule.every)},{" "}
                {repeatEndLabel(batch.schedule)}.
              </p>
              {batch.schedule.status === "ACTIVE" && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={applyToSchedule}
                    onChange={(e) => setApplyToSchedule(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                  />
                  Usar estes colaboradores e valores também nas próximas repetições
                </label>
              )}
            </div>
          ) : (
            !batch && (
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-slate-700">
                  <input
                    type="checkbox"
                    checked={repeat}
                    onChange={(e) => setRepeat(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                  />
                  Repetir este pagamento
                </label>
                {repeat && (
                  <div className="space-y-3 rounded-md bg-slate-50 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-slate-600">
                      A cada
                      <input
                        aria-label="Intervalo da repetição"
                        inputMode="numeric"
                        value={every}
                        onChange={(e) => setEvery(e.target.value)}
                        className={`${fieldBase} w-20`}
                      />
                      <select
                        aria-label="Unidade da repetição"
                        value={unit}
                        onChange={(e) => setUnit(e.target.value as DisbursementScheduleUnit)}
                        className={`${fieldBase} w-36`}
                      >
                        <option value="DAY">dia(s)</option>
                        <option value="WEEK">semana(s)</option>
                        <option value="MONTH">mês(es)</option>
                      </select>
                    </div>
                    <fieldset className="space-y-2 text-slate-600">
                      <legend className="mb-1">Termina</legend>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="repeat-end"
                          checked={repeatEnd === "never"}
                          onChange={() => setRepeatEnd("never")}
                        />
                        Quando eu encerrar
                      </label>
                      <label className="flex flex-wrap items-center gap-2">
                        <input
                          type="radio"
                          name="repeat-end"
                          checked={repeatEnd === "date"}
                          onChange={() => setRepeatEnd("date")}
                        />
                        Em
                        <input
                          type="date"
                          aria-label="Data final da repetição"
                          value={endsOn}
                          min={date}
                          disabled={repeatEnd !== "date"}
                          onChange={(e) => setEndsOn(e.target.value)}
                          className={`${fieldBase} w-auto`}
                        />
                      </label>
                      <label className="flex flex-wrap items-center gap-2">
                        <input
                          type="radio"
                          name="repeat-end"
                          checked={repeatEnd === "count"}
                          onChange={() => setRepeatEnd("count")}
                        />
                        Depois de
                        <input
                          aria-label="Quantidade de pagamentos"
                          inputMode="numeric"
                          value={occurrences}
                          disabled={repeatEnd !== "count"}
                          onChange={(e) => setOccurrences(e.target.value)}
                          className={`${fieldBase} w-20`}
                        />
                        pagamentos
                      </label>
                    </fieldset>
                    <p className="text-xs text-slate-500">
                      Cada repetição é agendada com estes valores e pode ser ajustada até a data dela. Cada
                      uma precisa da confirmação de {approver}.
                    </p>
                    {repeatProblem && (
                      <p role="alert" className="text-xs text-rose-600">
                        {repeatProblem}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          )}
        </section>

        <section className={sectionClass}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 font-semibold text-slate-900">
              <span className={stepClass}>3</span> Para quem e quanto
            </h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => downloadCsv(BATCH_CSV_TEMPLATE, "modelo_pagamento.csv")}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Baixar modelo
              </button>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <FileSpreadsheet size={14} /> Preencher por planilha
              </button>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv"
                aria-label="Planilha do pagamento"
                className="hidden"
                onChange={importFile}
              />
            </div>
          </div>
          {!recipients.length ? (
            <p className="text-slate-500">Cadastre os colaboradores na aba Colaboradores antes de criar um pagamento.</p>
          ) : (
            <>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <label className="relative block flex-1">
                  <span className="sr-only">Buscar colaborador</span>
                  <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar por nome ou CPF/CNPJ"
                    className={`${fieldClass} pl-9`}
                  />
                </label>
                <label className="flex items-center gap-2 text-slate-600">
                  <input
                    type="checkbox"
                    checked={onlySelected}
                    onChange={(e) => setOnlySelected(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                  />
                  Só quem vai receber
                </label>
              </div>
              {!!problems.length && (
                <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 p-3 text-rose-700">
                  <p className="font-medium">Nada foi preenchido. Corrija estas linhas:</p>
                  {problems.map((problem) => (
                    <p key={problem}>{problem}</p>
                  ))}
                </div>
              )}
              <div className="max-h-[24rem] overflow-y-auto rounded-md border border-slate-200">
                <table className="w-full text-left">
                  <thead className="sticky top-0 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Colaborador</th>
                      <th className="w-44 px-3 py-2">Valor líquido (R$)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visible.map((recipient) => (
                      <tr key={recipient.id}>
                        <td className="px-3 py-2">
                          <p className="font-medium text-slate-900">{recipient.name}</p>
                          <p className="text-xs text-slate-500">{maskDocument(recipient.document)}</p>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            aria-label={`Valor de ${recipient.name}`}
                            inputMode="decimal"
                            value={amounts[recipient.id] ?? ""}
                            onChange={(e) => setAmounts({ ...amounts, [recipient.id]: e.target.value })}
                            placeholder="não recebe"
                            className={`${fieldClass} h-9`}
                          />
                        </td>
                      </tr>
                    ))}
                    {!visible.length && (
                      <tr>
                        <td colSpan={2} className="px-3 py-6 text-center text-slate-500">
                          Nenhum colaborador encontrado.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </fieldset>

      <section className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50/50 p-4">
        <p className="font-semibold text-slate-900">
          {items.length} {items.length === 1 ? "colaborador" : "colaboradores"} · total {formatCents(total)}
        </p>
        {invalid && <p className="text-rose-600">Há valores inválidos: use, por exemplo, 1500,00.</p>}
        {items.length > MAX_ITEMS && (
          <p className="text-rose-600">Um pagamento aceita até {MAX_ITEMS} colaboradores.</p>
        )}
        <p className="flex items-start gap-2 text-slate-600">
          <CalendarClock size={16} className="mt-0.5 shrink-0 text-emerald-700" />
          {isToday
            ? `${approver} recebe agora o pedido de confirmação no WhatsApp, válido até 23:59 de hoje. Ao confirmar, os Pix saem na hora.`
            : `Em ${formatDate(date)}, às 08:00, ${approver} recebe o pedido de confirmação no WhatsApp, válido até 23:59. Ao confirmar, os Pix saem na hora.`}
        </p>
        {isToday && hoursLeftToday() <= 2 && (
          <p className="text-amber-700">
            Faltam menos de 2 horas para o fim do dia. Se preferir, escolha amanhã para dar mais tempo à confirmação.
          </p>
        )}
        {error && (
          <p role="alert" className="text-rose-700">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-slate-200 bg-white px-4 py-2.5 font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy || invalid || !items.length || items.length > MAX_ITEMS || Boolean(repeatProblem)}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : isToday ? <Send size={16} /> : <CalendarClock size={16} />}
            {isToday ? "Enviar para confirmação agora" : "Agendar pagamento"}
          </button>
        </div>
      </section>
    </form>
  );
}
