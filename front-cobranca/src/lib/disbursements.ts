import type {
  DisbursementBatchStatus,
  DisbursementItemStatus,
  DisbursementRecipientInput,
  DisbursementScheduleUnit,
} from "./api-client";

export const BATCH_STATUS_LABELS: Record<DisbursementBatchStatus, string> = {
  DRAFT: "Rascunho",
  SCHEDULED: "Agendado",
  AWAITING_APPROVAL: "Aguardando confirmação",
  PROCESSING: "Enviando Pix",
  COMPLETED: "Pago",
  COMPLETED_WITH_FAILURES: "Pago com falhas",
  REJECTED: "Recusado",
  EXPIRED: "Não confirmado",
  CANCELED: "Cancelado",
};

export const BATCH_STATUS_TONES: Record<DisbursementBatchStatus, string> = {
  DRAFT: "border-slate-200 bg-slate-50 text-slate-600",
  SCHEDULED: "border-sky-200 bg-sky-50 text-sky-700",
  AWAITING_APPROVAL: "border-amber-200 bg-amber-50 text-amber-700",
  PROCESSING: "border-indigo-200 bg-indigo-50 text-indigo-700",
  COMPLETED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  COMPLETED_WITH_FAILURES: "border-rose-200 bg-rose-50 text-rose-700",
  REJECTED: "border-rose-200 bg-rose-50 text-rose-700",
  EXPIRED: "border-rose-200 bg-rose-50 text-rose-700",
  CANCELED: "border-slate-200 bg-slate-100 text-slate-500",
};

const UNIT_LABELS: Record<DisbursementScheduleUnit, [string, string]> = {
  DAY: ["dia", "dias"],
  WEEK: ["semana", "semanas"],
  MONTH: ["mês", "meses"],
};

/** "a cada 1 mês", "a cada 2 semanas". */
export function repeatLabel(unit: DisbursementScheduleUnit, every: number): string {
  return `a cada ${every} ${UNIT_LABELS[unit][every === 1 ? 0 : 1]}`;
}

/** Plain-language end of a repetition. */
export function repeatEndLabel(schedule: {
  endsOn: string | null;
  maxOccurrences: number | null;
}): string {
  if (schedule.endsOn) return `até ${formatDate(schedule.endsOn)}`;
  if (schedule.maxOccurrences) return `${schedule.maxOccurrences} vezes`;
  return "sem data para terminar";
}

/** "05/11/2026" from a São Paulo date "2026-11-05". */
export function formatDate(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

/** Today in São Paulo, the calendar of the scheduled dates. */
export function saoPauloToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}

/** Hours left until 23:59 today in São Paulo, when a request made now expires. */
export function hoursLeftToday(now = new Date()): number {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      hour: "numeric",
      hourCycle: "h23",
    }).format(now),
  );
  return 24 - hour;
}

export const ITEM_STATUS_LABELS: Record<DisbursementItemStatus, string> = {
  PENDING: "A enviar",
  SENDING: "Enviando",
  IN_PROCESSING: "Em processamento na Efí",
  PAID: "Pago",
  FAILED: "Falhou",
  UNCERTAIN: "Em verificação: não pague manualmente",
  CANCELED: "Não enviado",
};

// Account types Efí accepts for a Pix by bank details (salary accounts are refused).
export const ACCOUNT_TYPES = [
  { value: "cacc", label: "Conta corrente" },
  { value: "svgs", label: "Poupança" },
  { value: "tran", label: "Conta de pagamento" },
] as const;

export function formatCents(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(cents / 100)
    .replace(/\s/g, " ");
}

/** "1.500,00", "1500,5", "1500.50" or "R$ 1.500" in cents; null when it is not an amount. */
export function parseAmountToCents(raw: string): number | null {
  let value = raw.replace(/R\$|\s/g, "");
  if (!value) return null;
  if (value.includes(",")) value = value.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const cents = Math.round(Number(value) * 100);
  return cents > 0 && Number.isSafeInteger(cents) ? cents : null;
}

export function formatDateTime(iso: string): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")}/${part("month")}/${part("year")} às ${part("hour")}:${part("minute")}`;
}

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function maskDocument(document: string): string {
  return document.length === 11
    ? `${document.slice(0, 3)}.${document.slice(3, 6)}.${document.slice(6, 9)}-${document.slice(9)}`
    : `${document.slice(0, 2)}.${document.slice(2, 5)}.${document.slice(5, 8)}/${document.slice(8, 12)}-${document.slice(12)}`;
}

type CsvRow = Record<string, string | undefined>;

function cell(row: CsvRow, names: string[]): string {
  for (const [key, value] of Object.entries(row)) {
    const normalized = key
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .trim()
      .toLowerCase();
    if (names.includes(normalized)) return (value ?? "").trim();
  }
  return "";
}

export const RECIPIENTS_CSV_TEMPLATE =
  "Nome,CPF/CNPJ,Chave Pix,ISPB do banco,Agência,Conta,Tipo de conta\n" +
  "Ana Souza,52998224725,ana@email.com,,,,\n" +
  "Prestador LTDA,11222333000181,,09089356,1,123453,cacc";

/** Collaborators from a spreadsheet; the server validates and answers errors by row. */
export function parseRecipientsCsv(rows: CsvRow[]): DisbursementRecipientInput[] {
  return rows.map((row) => {
    const pixKey = cell(row, ["chave pix", "chave", "pix"]);
    return {
      name: cell(row, ["nome"]),
      document: cell(row, ["cpf/cnpj", "cpf", "cnpj", "documento"]),
      ...(pixKey
        ? { pixKey }
        : {
            bankIspb: cell(row, ["ispb do banco", "ispb", "banco"]) || null,
            bankAgency: cell(row, ["agencia"]) || null,
            bankAccount: cell(row, ["conta"]) || null,
            bankAccountType:
              cell(row, ["tipo de conta", "tipo"]).toLowerCase() || null,
          }),
    };
  });
}

export const BATCH_CSV_TEMPLATE =
  'CPF/CNPJ,Valor\n52998224725,1500.00\n11222333000181,"980,00"';

/**
 * Batch items from a spreadsheet of document and net amount, matched to registered
 * active collaborators. Every problem is listed by spreadsheet line (header is line 1).
 */
export function parseBatchCsv(
  rows: CsvRow[],
  recipientsByDocument: Map<string, { id: string }>,
): { items: { recipientId: string; amountCents: number }[]; errors: string[] } {
  const items: { recipientId: string; amountCents: number }[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const line = index + 2;
    const document = onlyDigits(cell(row, ["cpf/cnpj", "cpf", "cnpj", "documento"]));
    const amountCents = parseAmountToCents(cell(row, ["valor", "valor liquido"]));
    const recipient = recipientsByDocument.get(document);
    if (!recipient)
      errors.push(`Linha ${line}: CPF/CNPJ sem colaborador ativo cadastrado.`);
    else if (amountCents === null)
      errors.push(`Linha ${line}: valor inválido.`);
    else if (seen.has(recipient.id))
      errors.push(`Linha ${line}: colaborador repetido na planilha.`);
    else {
      seen.add(recipient.id);
      items.push({ recipientId: recipient.id, amountCents });
    }
  });
  return { items, errors };
}

/** Error rows of an import refused by the server, as spreadsheet lines. */
export function importErrors(data: unknown): string[] {
  const errors = (data as { errors?: { row: number; message: string }[] } | null)
    ?.errors;
  return Array.isArray(errors)
    ? errors.map((error) => `Linha ${error.row + 1}: ${error.message}`)
    : [];
}

export function errorCode(error: unknown): string | null {
  const data = (error as { data?: { code?: unknown } } | null)?.data;
  return typeof data?.code === "string" ? data.code : null;
}

export function downloadCsv(content: string, fileName: string): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8;" }),
  );
  link.setAttribute("download", fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
