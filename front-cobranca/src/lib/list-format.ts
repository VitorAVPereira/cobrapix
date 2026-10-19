// Small formatters shared by the large lists (Baixas, Financeiro).

const BILLING_METHOD_LABELS: Record<string, string> = {
  PIX: "Pix",
  BOLETO: "Boleto",
  BOLIX: "Bolix",
  CREDIT_CARD: "Cartão",
};

export function billingMethodLabel(method: string): string {
  return BILLING_METHOD_LABELS[method] ?? method;
}

/** Date and time in São Paulo, the calendar the API filters by. */
export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

export function formatCount(value: number): string {
  return value.toLocaleString("pt-BR");
}

export function plural(value: number, one: string, many: string): string {
  return `${formatCount(value)} ${value === 1 ? one : many}`;
}
