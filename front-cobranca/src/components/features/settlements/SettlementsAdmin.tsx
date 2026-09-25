"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useApiClient } from "@/lib/use-api-client";
import type { ApiError } from "@/lib/api-client";
import {
  DECISION_LABELS,
  DIVERGENCE_DECISIONS,
  DIVERGENCE_LABELS,
  LEDGER_KIND_LABELS,
  SETTLEMENT_STATUS_LABELS,
  formatCents,
  parseMoneyToCents,
} from "@/lib/settlements";
import type {
  DivergenceDecision,
  SettlementDetail,
  SettlementDivergence,
  SettlementList,
  SettlementStatus,
  SettlementSummary,
} from "@/lib/settlements";

function messageOf(error: unknown, fallback: string): string {
  const apiError = error as ApiError;
  const data = apiError?.data as { message?: unknown } | undefined;
  return typeof data?.message === "string"
    ? data.message
    : apiError?.message || fallback;
}

function day(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("pt-BR") : "—";
}

function Card({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}): ReactNode {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

const STATUS_CLASSES: Record<SettlementStatus, string> = {
  AWAITING_EVIDENCE: "bg-amber-50 text-amber-800 border-amber-200",
  RECONCILED: "bg-emerald-50 text-emerald-800 border-emerald-200",
  DIVERGENT: "bg-rose-50 text-rose-800 border-rose-200",
};

export function SettlementsAdmin({
  companyId,
}: {
  companyId?: string;
}): ReactNode {
  const api = useApiClient();
  const [status, setStatus] = useState<SettlementStatus | "">("");
  const [page, setPage] = useState(1);
  const [list, setList] = useState<SettlementList | null>(null);
  const [summary, setSummary] = useState<SettlementSummary | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<SettlementDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextList, nextSummary] = await Promise.all([
        api.getSettlements({
          companyId,
          status: status || undefined,
          page,
          pageSize: 50,
        }),
        api.getSettlementSummary(companyId),
      ]);
      setList(nextList);
      setSummary(nextSummary);
      setSelected((current) =>
        current.filter((id) =>
          nextList.data.some(
            (row) => row.id === id && row.evidenceStatus === "PENDING",
          ),
        ),
      );
    } catch (loadError) {
      setError(
        messageOf(loadError, "Não foi possível carregar a conciliação."),
      );
    }
  }, [api, companyId, status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = useCallback(
    async (id: string) => {
      setError(null);
      try {
        setDetail(await api.getSettlement(id));
      } catch (detailError) {
        setError(
          messageOf(detailError, "Não foi possível abrir a conciliação."),
        );
      }
    },
    [api],
  );

  const expected = useMemo(
    () =>
      (list?.data ?? [])
        .filter((row) => selected.includes(row.id))
        .reduce((sum, row) => sum + row.platformFeeDueCents, 0),
    [list, selected],
  );

  async function recordEvidence(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const received = parseMoneyToCents(String(form.get("received") ?? ""));
    if (received === null) {
      setError("Informe o valor recebido no extrato, por exemplo 12,50.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.recordPlatformFeeEvidence({
        settlementIds: selected,
        reference: String(form.get("reference") ?? "").trim(),
        receivedAmountCents: received,
        note: String(form.get("note") ?? "").trim() || undefined,
      });
      setNotice(
        result.matched
          ? `Comprovação registrada: ${formatCents(result.receivedAmountCents)} conferem com a remuneração esperada.`
          : `Valor diferente do esperado (${formatCents(result.expectedAmountCents)}). As cobranças foram para revisão.`,
      );
      setSelected([]);
      formElement.reset();
      await load();
    } catch (evidenceError) {
      // Reload first: the server state may have changed (e.g. 409).
      await load();
      setError(
        messageOf(evidenceError, "Não foi possível registrar a comprovação."),
      );
    } finally {
      setBusy(false);
    }
  }

  async function toggleReversal(value: boolean): Promise<void> {
    if (!companyId) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateSettlementOptions(companyId, value);
      await load();
    } catch (optionError) {
      setError(messageOf(optionError, "Não foi possível salvar a opção."));
    } finally {
      setBusy(false);
    }
  }

  const divergentCount = summary?.settlements.DIVERGENT ?? 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Conciliação financeira
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Na conta Efí do próprio cliente o dinheiro vai direto para ele. Aqui a
          CifraMais confere a remuneração recebida por split e decide as
          divergências. Nada nesta tela transfere dinheiro.
        </p>
      </header>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          {notice}
        </p>
      )}

      {summary && (
        <section
          aria-label="Resumo"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <Card
            label="Recebido pelos clientes"
            value={formatCents(summary.receivedCents)}
          />
          <Card
            label="Tarifa Efí"
            value={formatCents(summary.efiFeeCents)}
            hint={
              summary.efiFeeEstimatedCents > 0
                ? `${formatCents(summary.efiFeeEstimatedCents)} ainda estimados`
                : undefined
            }
          />
          <Card
            label="Remuneração a comprovar"
            value={formatCents(summary.platformFeeAwaitingEvidenceCents)}
            hint="Saldo a conciliar"
          />
          <Card
            label="Remuneração comprovada"
            value={formatCents(summary.platformFeeEvidencedCents)}
          />
          <Card label="Devoluções" value={formatCents(summary.refundedCents)} />
          <Card
            label="Estornos de remuneração"
            value={formatCents(summary.platformFeeReversalCents)}
          />
          <Card
            label="Duplicidades"
            value={formatCents(summary.duplicatePaymentsCents)}
          />
          <Card label="Cobranças divergentes" value={String(divergentCount)} />
        </section>
      )}

      {companyId && summary?.options && (
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
          <input
            type="checkbox"
            checked={summary.options.refundPlatformFeeOnRefund}
            disabled={busy}
            onChange={(event) => void toggleReversal(event.target.checked)}
            className="mt-1 h-4 w-4"
          />
          <span>
            <span className="font-medium text-slate-900">
              Estornar remuneração em devolução
            </span>
            <span className="block text-slate-500">
              Quando o pagamento for devolvido, a remuneração proporcional passa
              a ser devida ao cliente. Vale para devoluções registradas a partir
              de agora.
            </span>
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium text-slate-700">
          Situação
          <select
            className="mt-1 block rounded-lg border border-slate-300 bg-white p-2"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as SettlementStatus | "");
              setPage(1);
            }}
          >
            <option value="">Todas</option>
            {(Object.keys(SETTLEMENT_STATUS_LABELS) as SettlementStatus[]).map(
              (key) => (
                <option key={key} value={key}>
                  {SETTLEMENT_STATUS_LABELS[key]}
                </option>
              ),
            )}
          </select>
        </label>
      </div>

      {list && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3">
                  <span className="sr-only">Selecionar</span>
                </th>
                <th className="p-3">Cliente</th>
                <th className="p-3">Pago em</th>
                <th className="p-3">Pago</th>
                <th className="p-3">Tarifa Efí</th>
                <th className="p-3">Remuneração</th>
                <th className="p-3">Situação</th>
                <th className="p-3">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list?.data.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-slate-500">
                    Nenhuma cobrança paga nesta situação.
                  </td>
                </tr>
              )}
              {list?.data.map((row) => {
                const selectable = row.evidenceStatus === "PENDING";
                return (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="p-3">
                      <input
                        type="checkbox"
                        aria-label={`Selecionar cobrança de ${row.companyName} paga em ${day(row.paidAt)}`}
                        disabled={!selectable}
                        checked={selected.includes(row.id)}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, row.id]
                              : current.filter((id) => id !== row.id),
                          )
                        }
                      />
                    </td>
                    <td className="p-3">
                      <span className="font-medium text-slate-900">
                        {row.companyName}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {row.billingMethod} · fatura {row.invoiceId.slice(0, 8)}
                      </span>
                    </td>
                    <td className="p-3">{day(row.paidAt)}</td>
                    <td className="p-3">
                      {formatCents(row.totals.paymentCents)}
                    </td>
                    <td className="p-3">
                      {formatCents(row.totals.efiFeeCents)}
                    </td>
                    <td className="p-3">
                      {formatCents(row.platformFeeDueCents)}
                    </td>
                    <td className="p-3">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[row.status]}`}
                      >
                        {SETTLEMENT_STATUS_LABELS[row.status]}
                      </span>
                      {row.openDivergences.length > 0 && (
                        <span className="block text-xs text-rose-700">
                          {row.openDivergences
                            .map(
                              (item) =>
                                DIVERGENCE_LABELS[item.code] ?? item.code,
                            )
                            .join("; ")}
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <button
                        type="button"
                        className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold"
                        onClick={() => void openDetail(row.id)}
                      >
                        Detalhes
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {list && list.total > list.pageSize && (
        <div className="flex items-center gap-3 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="rounded border px-3 py-1 disabled:opacity-50"
          >
            Anterior
          </button>
          <span>
            Página {page} de {Math.ceil(list.total / list.pageSize)}
          </span>
          <button
            type="button"
            disabled={page * list.pageSize >= list.total}
            onClick={() => setPage(page + 1)}
            className="rounded border px-3 py-1 disabled:opacity-50"
          >
            Próxima
          </button>
        </div>
      )}

      {selected.length > 0 && (
        <form
          aria-label="Comprovar remuneração"
          className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 text-sm"
          onSubmit={(event) => void recordEvidence(event)}
        >
          <h2 className="text-lg font-semibold text-slate-900">
            Comprovar remuneração recebida
          </h2>
          <p className="text-slate-600">
            {selected.length} cobrança(s) selecionada(s). Remuneração esperada:{" "}
            <strong>{formatCents(expected)}</strong>. O servidor recalcula o
            valor esperado; se o valor do extrato for diferente, as cobranças
            vão para revisão.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="font-medium text-slate-700">
              Referência no extrato
              <input
                name="reference"
                required
                maxLength={128}
                className="mt-1 w-full rounded-lg border border-slate-300 p-2"
              />
            </label>
            <label className="font-medium text-slate-700">
              Valor recebido (R$)
              <input
                name="received"
                required
                inputMode="decimal"
                className="mt-1 w-full rounded-lg border border-slate-300 p-2"
              />
            </label>
            <label className="font-medium text-slate-700">
              Observação
              <input
                name="note"
                maxLength={500}
                className="mt-1 w-full rounded-lg border border-slate-300 p-2"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            Registrar comprovação
          </button>
        </form>
      )}

      {detail && (
        <SettlementDetailPanel
          detail={detail}
          onClose={() => setDetail(null)}
          onChanged={async (message) => {
            setNotice(message);
            await Promise.all([openDetail(detail.id), load()]);
          }}
          onError={(message) => setError(message)}
        />
      )}
    </div>
  );
}

function SettlementDetailPanel({
  detail,
  onClose,
  onChanged,
  onError,
}: {
  detail: SettlementDetail;
  onClose: () => void;
  onChanged: (message: string) => Promise<void>;
  onError: (message: string) => void;
}): ReactNode {
  return (
    <section
      aria-label="Detalhe da conciliação"
      className="space-y-4 rounded-xl border border-slate-300 bg-white p-5 text-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            {detail.paymentCharge.company.corporateName} · fatura{" "}
            {detail.invoiceId.slice(0, 8)}
          </h2>
          <p className="text-slate-600">
            {SETTLEMENT_STATUS_LABELS[detail.status]} · valor da cobrança{" "}
            {formatCents(detail.paymentCharge.grossAmountCents)} · líquido do
            cliente {formatCents(detail.totals.customerNetCents)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold"
        >
          Fechar
        </button>
      </div>

      {detail.platformFeeEvidence && (
        <p className="text-slate-600">
          Comprovação: {detail.platformFeeEvidence.reference} ·{" "}
          {formatCents(detail.platformFeeEvidence.receivedAmountCents)}{" "}
          recebidos de{" "}
          {formatCents(detail.platformFeeEvidence.expectedAmountCents)}{" "}
          esperados
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full text-left">
          <caption className="mb-2 text-left font-semibold text-slate-800">
            Lançamentos
          </caption>
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="py-1 pr-3">Data</th>
              <th className="py-1 pr-3">Lançamento</th>
              <th className="py-1 pr-3">Valor</th>
              <th className="py-1 pr-3">Origem</th>
            </tr>
          </thead>
          <tbody>
            {detail.ledgerEntries.map((entry) => (
              <tr key={entry.id} className="border-t border-slate-100">
                <td className="py-1 pr-3">{day(entry.occurredAt)}</td>
                <td className="py-1 pr-3">
                  {LEDGER_KIND_LABELS[entry.kind] ?? entry.kind}
                  {entry.estimated ? " (estimada)" : ""}
                </td>
                <td className="py-1 pr-3">{formatCents(entry.amountCents)}</td>
                <td className="py-1 pr-3 text-slate-500">
                  {entry.evidenceReference ?? entry.source}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3">
        <h3 className="font-semibold text-slate-800">Divergências</h3>
        {detail.divergences.length === 0 && (
          <p className="text-slate-500">Nenhuma divergência.</p>
        )}
        {detail.divergences.map((divergence) => (
          <DivergenceItem
            key={divergence.id}
            divergence={divergence}
            onChanged={onChanged}
            onError={onError}
          />
        ))}
      </div>
    </section>
  );
}

function DivergenceItem({
  divergence,
  onChanged,
  onError,
}: {
  divergence: SettlementDivergence;
  onChanged: (message: string) => Promise<void>;
  onError: (message: string) => void;
}): ReactNode {
  const api = useApiClient();
  const options = DIVERGENCE_DECISIONS[divergence.code] ?? [];
  const [decision, setDecision] = useState<DivergenceDecision | "">(
    options[0]?.decision ?? "",
  );
  const [busy, setBusy] = useState(false);
  const requires = options.find(
    (option) => option.decision === decision,
  )?.requires;
  const title = DIVERGENCE_LABELS[divergence.code] ?? divergence.code;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!decision) return;
    const form = new FormData(event.currentTarget);
    const text = (name: string) =>
      String(form.get(name) ?? "").trim() || undefined;
    setBusy(true);
    try {
      const result = await api.resolveSettlementDivergence(divergence.id, {
        decision,
        reference: text("reference"),
        note: text("note"),
        dueDate: text("dueDate"),
      });
      await onChanged(
        result.complementaryInvoiceId
          ? "Decisão registrada. A fatura complementar foi criada em rascunho."
          : "Decisão registrada.",
      );
    } catch (resolveError) {
      onError(messageOf(resolveError, "Não foi possível registrar a decisão."));
    } finally {
      setBusy(false);
    }
  }

  if (divergence.status === "RESOLVED")
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="font-medium text-slate-800">{title}</p>
        <p className="text-slate-600">
          Decidido:{" "}
          {DECISION_LABELS[divergence.decision as DivergenceDecision] ??
            divergence.decision}
          {divergence.decisionReference
            ? ` · ${divergence.decisionReference}`
            : ""}
          {divergence.decisionNote ? ` · ${divergence.decisionNote}` : ""} em{" "}
          {day(divergence.resolvedAt)}
        </p>
      </div>
    );

  return (
    <form
      aria-label={title}
      className="space-y-2 rounded-lg border border-rose-200 bg-rose-50 p-3"
      onSubmit={(event) => void submit(event)}
    >
      <p className="font-medium text-rose-900">
        {title}
        {divergence.amountCents !== null
          ? ` · ${formatCents(divergence.amountCents)}`
          : ""}
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="font-medium text-slate-700">
          Decisão
          <select
            className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2"
            value={decision}
            onChange={(event) =>
              setDecision(event.target.value as DivergenceDecision)
            }
          >
            {options.map((option) => (
              <option key={option.decision} value={option.decision}>
                {DECISION_LABELS[option.decision]}
              </option>
            ))}
          </select>
        </label>
        {requires === "reference" && (
          <label className="font-medium text-slate-700">
            Referência do comprovante
            <input
              name="reference"
              required
              maxLength={128}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2"
            />
          </label>
        )}
        {requires === "note" && (
          <label className="font-medium text-slate-700">
            Motivo
            <input
              name="note"
              required
              maxLength={500}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2"
            />
          </label>
        )}
        {requires === "dueDate" && (
          <label className="font-medium text-slate-700">
            Vencimento da fatura complementar
            <input
              name="dueDate"
              type="date"
              required
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2"
            />
          </label>
        )}
      </div>
      <button
        type="submit"
        disabled={busy || !decision}
        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
      >
        Registrar decisão
      </button>
    </form>
  );
}
