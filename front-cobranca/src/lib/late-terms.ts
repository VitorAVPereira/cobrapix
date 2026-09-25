// Fine, interest per month and days accepting payment after the due date.
// Limits mirror the backend: fine up to 10% (Efí limit), interest up to 100%
// per month and up to 365 days after the due date.
export const LATE_FINE_MAX_PERCENTAGE = 10;
export const LATE_INTEREST_MONTHLY_MAX_PERCENTAGE = 100;
export const PAYMENT_DAYS_AFTER_DUE_MAX = 365;
// Consumer protection code (CDC): fine up to 2% for individuals.
export const CONSUMER_FINE_LIMIT_PERCENTAGE = 2;

export interface LateTermsFormValues {
  fine: string;
  interest: string;
  days: string;
}

export interface LateTermsValues {
  fine: number | null;
  interest: number | null;
  days: number | null;
}

export const EMPTY_LATE_TERMS: LateTermsFormValues = {
  fine: "",
  interest: "",
  days: "",
};

function parsePercentage(
  value: string,
  max: number,
  label: string,
): { value: number | null } | { error: string } {
  const text = value.trim().replace(",", ".");
  if (text === "") return { value: null };
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text) || Number(text) > max)
    return {
      error: `${label} deve estar entre 0 e ${max}%, com até 2 casas decimais.`,
    };
  return { value: Number(text) };
}

// Empty fields stay null (company default on a new charge); zero means none.
export function parseLateTermsForm(
  values: LateTermsFormValues,
): { terms: LateTermsValues } | { error: string } {
  const fine = parsePercentage(values.fine, LATE_FINE_MAX_PERCENTAGE, "Multa");
  if ("error" in fine) return fine;
  const interest = parsePercentage(
    values.interest,
    LATE_INTEREST_MONTHLY_MAX_PERCENTAGE,
    "Juros ao mês",
  );
  if ("error" in interest) return interest;
  const daysText = values.days.trim();
  if (
    daysText !== "" &&
    (!/^\d{1,3}$/.test(daysText) ||
      Number(daysText) > PAYMENT_DAYS_AFTER_DUE_MAX)
  )
    return {
      error: `Dias após o vencimento deve ser um número inteiro de 0 a ${PAYMENT_DAYS_AFTER_DUE_MAX}.`,
    };
  return {
    terms: {
      fine: fine.value,
      interest: interest.value,
      days: daysText === "" ? null : Number(daysText),
    },
  };
}

export function lateTermsFormFromValues(values: {
  fine: number;
  interest: number;
  days: number;
}): LateTermsFormValues {
  return {
    fine: String(values.fine),
    interest: String(values.interest),
    days: String(values.days),
  };
}

export function isIndividualDocument(document: string | undefined): boolean {
  return (document ?? "").replace(/\D/g, "").length === 11;
}

export function describeLateTerms(values: {
  fine: number;
  interest: number;
  days: number;
}): string {
  const parts = [
    values.fine > 0
      ? `multa de ${formatPercent(values.fine)}`
      : "sem multa",
    values.interest > 0
      ? `juros de ${formatPercent(values.interest)} ao mês`
      : "sem juros",
    values.days > 0
      ? `pagamento aceito até ${values.days} dia(s) após o vencimento`
      : "pagamento somente até o vencimento",
  ];
  return parts.join(", ");
}

function formatPercent(value: number): string {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}
