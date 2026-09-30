export type PublicPaymentState = "PAYABLE" | "PAID" | "CANCELED" | "EXPIRED" | "UNAVAILABLE";

export interface PublicPaymentData {
  invoiceId: string;
  companyName: string;
  debtorName: string;
  amount: number;
  dueDate: string;
  billingType: string;
  state: PublicPaymentState;
  canPay: boolean;
  paidAt: string | null;
  pixCopyPaste: string | null;
  boletoLine: string | null;
  boletoLink: string | null;
  boletoPdf: string | null;
  expiresAt: string | null;
}

// "invalid": the backend refused the link (bad, expired or unknown) and says
// nothing about the charge. "unavailable": the API could not answer; this is
// never presented as a paid or canceled charge.
export type LoadedPayment =
  | { kind: "ok"; data: PublicPaymentData }
  | { kind: "invalid" }
  | { kind: "unavailable" };

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const TIMEOUT_MS = 8_000;
const STATES: readonly PublicPaymentState[] = ["PAYABLE", "PAID", "CANCELED", "EXPIRED", "UNAVAILABLE"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// Only the expected fields reach the page. A body without "state" comes from
// an API published before it existed, which only answered payable charges.
export function parsePublicPayment(body: unknown): PublicPaymentData | null {
  if (!isRecord(body)) return null;
  const legacy = body.state === undefined;
  const state = legacy ? "PAYABLE" : body.state;
  if (!STATES.includes(state as PublicPaymentState)) return null;
  const invoiceId = text(body.invoiceId);
  const companyName = text(body.companyName);
  const debtorName = text(body.debtorName);
  const dueDate = text(body.dueDate);
  if (!invoiceId || !companyName || !debtorName || !dueDate) return null;
  if (typeof body.amount !== "number" || !Number.isFinite(body.amount)) return null;
  const canPay = state === "PAYABLE" && (legacy || body.canPay === true);
  return {
    invoiceId,
    companyName,
    debtorName,
    amount: body.amount,
    dueDate,
    billingType: text(body.billingType) ?? "PIX",
    state: state as PublicPaymentState,
    canPay,
    paidAt: text(body.paidAt),
    // Instruments are dropped unless payment is available.
    pixCopyPaste: canPay ? text(body.pixCopyPaste) : null,
    boletoLine: canPay ? text(body.boletoLine) : null,
    boletoLink: canPay ? text(body.boletoLink) : null,
    boletoPdf: canPay ? text(body.boletoPdf) : null,
    expiresAt: text(body.expiresAt),
  };
}

// Server-side, uncached and without any session or JWT.
export async function loadPayment(
  signedToken: string,
  fetcher: typeof fetch = fetch,
): Promise<LoadedPayment> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(`${API_URL}/payments/public/${encodeURIComponent(signedToken)}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (response.status === 400 || response.status === 404) return { kind: "invalid" };
    if (!response.ok) return { kind: "unavailable" };
    const data = parsePublicPayment(await response.json());
    return data ? { kind: "ok", data } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}
