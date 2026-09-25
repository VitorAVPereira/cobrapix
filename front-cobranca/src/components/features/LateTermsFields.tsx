"use client";

import {
  CONSUMER_FINE_LIMIT_PERCENTAGE,
  LATE_FINE_MAX_PERCENTAGE,
  LATE_INTEREST_MONTHLY_MAX_PERCENTAGE,
  PAYMENT_DAYS_AFTER_DUE_MAX,
  type LateTermsFormValues,
} from "@/lib/late-terms";

interface LateTermsFieldsProps {
  idPrefix: string;
  values: LateTermsFormValues;
  onChange: (values: LateTermsFormValues) => void;
  disabled?: boolean;
  // Shown when a field is empty: the value that will be used instead.
  placeholders?: Partial<LateTermsFormValues>;
  // Debtor is an individual (CPF): warn above the consumer fine limit.
  individualDebtor?: boolean;
}

const inputClass =
  "h-11 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";

export function LateTermsFields({
  idPrefix,
  values,
  onChange,
  disabled,
  placeholders,
  individualDebtor,
}: LateTermsFieldsProps) {
  const fine = Number(values.fine.replace(",", "."));
  const fineAboveConsumerLimit =
    individualDebtor === true &&
    Number.isFinite(fine) &&
    fine > CONSUMER_FINE_LIMIT_PERCENTAGE;

  return (
    <div className="space-y-2">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5" htmlFor={`${idPrefix}-fine`}>
          <span className="text-xs font-semibold uppercase text-slate-500">
            Multa (%)
          </span>
          <input
            id={`${idPrefix}-fine`}
            type="text"
            inputMode="decimal"
            disabled={disabled}
            value={values.fine}
            placeholder={placeholders?.fine ?? "0"}
            onChange={(event) =>
              onChange({ ...values, fine: event.target.value })
            }
            className={inputClass}
            aria-describedby={`${idPrefix}-fine-help`}
          />
          <span id={`${idPrefix}-fine-help`} className="text-xs text-slate-500">
            Percentual único após o vencimento, até{" "}
            {LATE_FINE_MAX_PERCENTAGE}%.
          </span>
        </label>
        <label
          className="flex flex-col gap-1.5"
          htmlFor={`${idPrefix}-interest`}
        >
          <span className="text-xs font-semibold uppercase text-slate-500">
            Juros ao mês (%)
          </span>
          <input
            id={`${idPrefix}-interest`}
            type="text"
            inputMode="decimal"
            disabled={disabled}
            value={values.interest}
            placeholder={placeholders?.interest ?? "0"}
            onChange={(event) =>
              onChange({ ...values, interest: event.target.value })
            }
            className={inputClass}
            aria-describedby={`${idPrefix}-interest-help`}
          />
          <span
            id={`${idPrefix}-interest-help`}
            className="text-xs text-slate-500"
          >
            Proporcional aos dias de atraso, até{" "}
            {LATE_INTEREST_MONTHLY_MAX_PERCENTAGE}% ao mês.
          </span>
        </label>
        <label className="flex flex-col gap-1.5" htmlFor={`${idPrefix}-days`}>
          <span className="text-xs font-semibold uppercase text-slate-500">
            Dias aceitando pagamento
          </span>
          <input
            id={`${idPrefix}-days`}
            type="text"
            inputMode="numeric"
            disabled={disabled}
            value={values.days}
            placeholder={placeholders?.days ?? "30"}
            onChange={(event) =>
              onChange({ ...values, days: event.target.value })
            }
            className={inputClass}
            aria-describedby={`${idPrefix}-days-help`}
          />
          <span id={`${idPrefix}-days-help`} className="text-xs text-slate-500">
            Após o vencimento, de 0 a {PAYMENT_DAYS_AFTER_DUE_MAX}.
          </span>
        </label>
      </div>
      {fineAboveConsumerLimit && (
        <p
          role="alert"
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          Para pessoa física, o Código de Defesa do Consumidor limita a multa
          a {CONSUMER_FINE_LIMIT_PERCENTAGE}%.
        </p>
      )}
    </div>
  );
}
