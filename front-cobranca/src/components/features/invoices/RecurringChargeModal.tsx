"use client";

import { useState, type FormEvent } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";
import type {
  BillingMethod,
  BillingSettings,
  DebtorOption,
  RecurrenceFrequency,
} from "@/lib/api-client";
import { formatBillingMethodRateLabel } from "@/lib/billing-fees";
import { useApiClient } from "@/lib/use-api-client";
import {
  EMPTY_LATE_TERMS,
  isIndividualDocument,
  lateTermsFormFromValues,
  parseLateTermsForm,
  type LateTermsFormValues,
} from "@/lib/late-terms";
import {
  RECURRENCE_FREQUENCY_OPTIONS,
  todayInSaoPaulo,
} from "@/lib/recurrence-frequency";
import { ClientPicker } from "@/components/features/invoices/ClientPicker";
import { LateTermsFields } from "@/components/features/LateTermsFields";
import {
  SendNowFields,
  initialSendNow,
  sendNowPayload,
  sendNowProblem,
  type SendNowValue,
} from "@/components/features/SendNowFields";

interface RecurringForm {
  billingType: BillingMethod;
  amount: string;
  frequency: RecurrenceFrequency;
  firstDueDate: string;
  studentName: string;
  studentEnrollment: string;
  studentGroup: string;
  lateTerms: LateTermsFormValues;
}

const fieldClass =
  "h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: { details?: string[]; message?: string } })
      .data;
    if (data?.details?.length) return data.details.join(" | ");
    if (data?.message) return data.message;
  }
  return fallback;
}

/**
 * New recurring charge for a registered client: the first due date and the frequency set
 * the schedule; each invoice is generated ahead of its due date.
 */
export function RecurringChargeModal({
  initialClient,
  settings,
  onClose,
  onCreated,
}: {
  initialClient: DebtorOption | null;
  settings: BillingSettings | null;
  onClose: () => void;
  onCreated: (client: DebtorOption) => void | Promise<void>;
}) {
  const apiClient = useApiClient();
  const paymentMethods: BillingMethod[] = settings?.enabledBillingMethods.length
    ? settings.enabledBillingMethods.filter((method) => method !== "BOLETO")
    : ["BOLIX"];
  const isEducationSegment = settings?.businessSegment === "EDUCATION";
  const [client, setClient] = useState<DebtorOption | null>(initialClient);
  const [form, setForm] = useState<RecurringForm>(() => ({
    billingType: paymentMethods.includes("BOLIX")
      ? "BOLIX"
      : (paymentMethods[0] ?? "BOLIX"),
    amount: "",
    frequency: "MONTHLY",
    firstDueDate: "",
    studentName: "",
    studentEnrollment: "",
    studentGroup: "",
    lateTerms: settings
      ? lateTermsFormFromValues({
          fine: settings.lateFinePercentage ?? 0,
          interest: settings.lateInterestMonthlyPercentage ?? 0,
          days: settings.paymentDaysAfterDue ?? 30,
        })
      : EMPTY_LATE_TERMS,
  }));
  const [sendNow, setSendNow] = useState<SendNowValue>(() =>
    initialSendNow(settings?.autoGenerateFirstCharge),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const today = todayInSaoPaulo();

  function update<K extends keyof RecurringForm>(
    key: K,
    value: RecurringForm[K],
  ): void {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    const amount = Number(form.amount);
    if (!client) {
      setError("Escolha o cliente da cobrança.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Informe um valor válido.");
      return;
    }
    if (!form.firstDueDate) {
      setError("Informe o primeiro vencimento.");
      return;
    }
    if (form.firstDueDate < today) {
      setError("O primeiro vencimento não pode ser anterior a hoje.");
      return;
    }
    const sendProblem = sendNowProblem(sendNow);
    if (sendProblem) {
      setError(sendProblem);
      return;
    }
    // Optional: an empty field uses the company default, zero means none.
    const parsedLateTerms = parseLateTermsForm(form.lateTerms);
    if ("error" in parsedLateTerms) {
      setError(parsedLateTerms.error);
      return;
    }

    setSaving(true);
    try {
      await apiClient.createDebtorInvoice(client.debtorId, {
        original_amount: amount,
        billing_type: form.billingType,
        recurring: true,
        frequency: form.frequency,
        first_due_date: form.firstDueDate,
        late_fine_percentage: parsedLateTerms.terms.fine,
        late_interest_monthly_percentage: parsedLateTerms.terms.interest,
        payment_days_after_due: parsedLateTerms.terms.days,
        ...sendNowPayload(sendNow),
        ...(isEducationSegment
          ? {
              studentName: form.studentName.trim() || undefined,
              studentEnrollment: form.studentEnrollment.trim() || undefined,
              studentGroup: form.studentGroup.trim() || undefined,
            }
          : {}),
      });
      await onCreated(client);
    } catch (submitError: unknown) {
      setError(
        getErrorMessage(submitError, "Não foi possível criar a recorrência."),
      );
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-recurring-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-md bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 id="new-recurring-title" className="font-semibold text-slate-900">
              Nova cobrança recorrente
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              A cobrança se repete na periodicidade escolhida, a partir do
              primeiro vencimento.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="Fechar modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Validated below, so every message is the same Portuguese text. */}
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
            {error && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 sm:col-span-2"
              >
                <AlertCircle className="mt-0.5 shrink-0" size={16} />
                {error}
              </p>
            )}
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-xs font-semibold uppercase text-slate-500">
                Cliente
              </span>
              <ClientPicker value={client} onChange={setClient} />
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase text-slate-500">
                Forma de pagamento
              </span>
              <select
                required
                value={form.billingType}
                onChange={(event) =>
                  update("billingType", event.target.value as BillingMethod)
                }
                className={fieldClass}
              >
                {paymentMethods.map((method) => (
                  <option key={method} value={method}>
                    {formatBillingMethodRateLabel(method, settings)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase text-slate-500">
                Valor (R$)
              </span>
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(event) => update("amount", event.target.value)}
                className={fieldClass}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase text-slate-500">
                Periodicidade
              </span>
              <select
                value={form.frequency}
                onChange={(event) =>
                  update("frequency", event.target.value as RecurrenceFrequency)
                }
                className={fieldClass}
              >
                {RECURRENCE_FREQUENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase text-slate-500">
                Primeiro vencimento
              </span>
              <input
                required
                type="date"
                min={today}
                value={form.firstDueDate}
                onChange={(event) => update("firstDueDate", event.target.value)}
                className={fieldClass}
              />
            </label>
            <p className="-mt-2 text-xs text-slate-500 sm:col-span-2">
              Nos meses mais curtos, um vencimento no dia 29, 30 ou 31 cai no
              último dia do mês. A periodicidade não muda depois de criada.
            </p>

            {isEducationSegment && (
              <>
                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className="text-xs font-semibold uppercase text-slate-500">
                    Nome do aluno
                  </span>
                  <input
                    type="text"
                    value={form.studentName}
                    onChange={(event) => update("studentName", event.target.value)}
                    className={fieldClass}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase text-slate-500">
                    Matrícula
                  </span>
                  <input
                    type="text"
                    value={form.studentEnrollment}
                    onChange={(event) =>
                      update("studentEnrollment", event.target.value)
                    }
                    className={fieldClass}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase text-slate-500">
                    Turma/Curso
                  </span>
                  <input
                    type="text"
                    value={form.studentGroup}
                    onChange={(event) => update("studentGroup", event.target.value)}
                    className={fieldClass}
                  />
                </label>
              </>
            )}

            <fieldset className="sm:col-span-2">
              <legend className="mb-2 text-sm font-semibold text-slate-800">
                Multa, juros e prazo após o vencimento{" "}
                <span className="font-normal text-slate-500">(opcional)</span>
              </legend>
              <LateTermsFields
                idPrefix="recurring-charge-late-terms"
                values={form.lateTerms}
                onChange={(values) => update("lateTerms", values)}
                disabled={saving}
                placeholders={{
                  fine: "Padrão da empresa",
                  interest: "Padrão da empresa",
                  days: "Padrão da empresa",
                }}
                individualDebtor={isIndividualDocument(client?.document ?? "")}
              />
              <p className="mt-2 text-xs text-slate-500">
                Vem com o padrão de Configurações → Geral e vale para todas as
                cobranças desta recorrência. Campo vazio usa o padrão; 0
                significa sem multa, sem juros ou sem pagamento após o
                vencimento.
              </p>
            </fieldset>
            <div className="sm:col-span-2">
              <SendNowFields value={sendNow} onChange={setSendNow} disabled={saving} />
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving && <Loader2 size={16} className="animate-spin" />}
              Salvar recorrência
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
