// Reconciliation of payments received in the customer's own Efí account
// (Phase A). CifraMais does not hold or pay out money in this mode.

export type SettlementStatus = "AWAITING_EVIDENCE" | "RECONCILED" | "DIVERGENT";
export type EvidenceStatus =
  | "NOT_REQUIRED"
  | "PENDING"
  | "CONFIRMED"
  | "MISMATCH";

export interface SettlementTotals {
  paymentCents: number;
  efiFeeCents: number;
  platformFeeCents: number;
  refundedCents: number;
  platformFeeReversalCents: number;
  duplicatePaymentsCents: number;
  customerNetCents: number;
}

export interface SettlementListItem {
  id: string;
  companyId: string;
  companyName: string;
  invoiceId: string;
  paymentChargeId: string;
  billingMethod: string;
  status: SettlementStatus;
  evidenceStatus: EvidenceStatus;
  grossAmountCents: number;
  paidAmountCents: number | null;
  paidAt: string | null;
  platformFeeDueCents: number;
  totals: SettlementTotals;
  openDivergences: Array<{
    id: string;
    code: string;
    amountCents: number | null;
  }>;
}

export interface SettlementList {
  total: number;
  page: number;
  pageSize: number;
  data: SettlementListItem[];
}

export interface SettlementSummary {
  options?: { refundPlatformFeeOnRefund: boolean };
  settlements: Partial<Record<SettlementStatus, number>>;
  receivedCents: number;
  efiFeeCents: number;
  efiFeeEstimatedCents: number;
  platformFeeCents: number;
  refundedCents: number;
  platformFeeReversalCents: number;
  duplicatePaymentsCents: number;
  platformFeeAwaitingEvidenceCents: number;
  platformFeeEvidencedCents: number;
  openDivergences: Array<{ code: string; count: number; amountCents: number }>;
}

export interface SettlementDivergence {
  id: string;
  code: string;
  reference: string;
  amountCents: number | null;
  status: "OPEN" | "RESOLVED";
  decision: string | null;
  decisionReference: string | null;
  decisionNote: string | null;
  complementaryInvoiceId: string | null;
  resolvedAt: string | null;
  detectedAt: string;
}

export interface LedgerEntry {
  id: string;
  kind: string;
  amountCents: number;
  estimated: boolean;
  source: string;
  evidenceReference: string | null;
  occurredAt: string;
}

export interface SettlementDetail {
  id: string;
  companyId: string;
  invoiceId: string;
  status: SettlementStatus;
  evidenceStatus: EvidenceStatus;
  platformFeeDueCents: number;
  paymentCharge: {
    billingMethod: string;
    grossAmountCents: number;
    paidAmountCents: number | null;
    paidAt: string | null;
    status: string;
    company: { corporateName: string };
  };
  ledgerEntries: LedgerEntry[];
  divergences: SettlementDivergence[];
  platformFeeEvidence: {
    reference: string;
    receivedAmountCents: number;
    expectedAmountCents: number;
    matched: boolean;
    createdAt: string;
  } | null;
  totals: SettlementTotals;
}

export interface PlatformFeeEvidenceResult {
  id: string;
  reference: string;
  receivedAmountCents: number;
  expectedAmountCents: number;
  matched: boolean;
  settlementIds: string[];
}

export type DivergenceDecision =
  | "ACCEPT_AS_SETTLEMENT"
  | "ISSUE_COMPLEMENTARY"
  | "REFUND_REGISTERED"
  | "KEEP_AS_CREDIT"
  | "ACCEPT_DIFFERENCE"
  | "ADJUSTMENT_SETTLED"
  | "REVERSAL_PAID"
  | "REVERSAL_WAIVED";

type Requirement = "reference" | "note" | "dueDate";

// Mirrors the server rules; the server remains the authority.
export const DIVERGENCE_DECISIONS: Record<
  string,
  Array<{ decision: DivergenceDecision; requires: Requirement }>
> = {
  PAYMENT_BELOW_CHARGE: [
    { decision: "ACCEPT_AS_SETTLEMENT", requires: "note" },
    { decision: "ISSUE_COMPLEMENTARY", requires: "dueDate" },
  ],
  PAYMENT_ABOVE_EXPECTED: [
    { decision: "ACCEPT_AS_SETTLEMENT", requires: "note" },
    { decision: "REFUND_REGISTERED", requires: "reference" },
  ],
  DUPLICATE_PAYMENT: [
    { decision: "REFUND_REGISTERED", requires: "reference" },
    { decision: "KEEP_AS_CREDIT", requires: "note" },
  ],
  PLATFORM_FEE_EVIDENCE_MISMATCH: [
    { decision: "ACCEPT_DIFFERENCE", requires: "note" },
    { decision: "ADJUSTMENT_SETTLED", requires: "reference" },
  ],
  PLATFORM_FEE_CHANGED_AFTER_EVIDENCE: [
    { decision: "ACCEPT_DIFFERENCE", requires: "note" },
    { decision: "ADJUSTMENT_SETTLED", requires: "reference" },
  ],
  PLATFORM_FEE_REVERSAL_DUE: [
    { decision: "REVERSAL_PAID", requires: "reference" },
    { decision: "REVERSAL_WAIVED", requires: "note" },
  ],
};

export const DIVERGENCE_LABELS: Record<string, string> = {
  PAYMENT_BELOW_CHARGE: "Pago abaixo do valor",
  PAYMENT_ABOVE_EXPECTED: "Pago acima do esperado",
  DUPLICATE_PAYMENT: "Pagamento em duplicidade (crédito a devolver)",
  PLATFORM_FEE_EVIDENCE_MISMATCH: "Remuneração comprovada com valor diferente",
  PLATFORM_FEE_CHANGED_AFTER_EVIDENCE:
    "Remuneração alterada após a comprovação",
  PLATFORM_FEE_REVERSAL_DUE: "Estorno de remuneração devido ao cliente",
};

export const DECISION_LABELS: Record<DivergenceDecision, string> = {
  ACCEPT_AS_SETTLEMENT: "Aceitar como quitação",
  ISSUE_COMPLEMENTARY: "Gerar fatura complementar do saldo",
  REFUND_REGISTERED: "Registrar devolução realizada",
  KEEP_AS_CREDIT: "Manter como crédito do pagador",
  ACCEPT_DIFFERENCE: "Aceitar a diferença",
  ADJUSTMENT_SETTLED: "Registrar acerto realizado",
  REVERSAL_PAID: "Registrar estorno realizado",
  REVERSAL_WAIVED: "Dispensar o estorno",
};

export const SETTLEMENT_STATUS_LABELS: Record<SettlementStatus, string> = {
  AWAITING_EVIDENCE: "Aguardando comprovação",
  RECONCILED: "Conciliada",
  DIVERGENT: "Divergente",
};

export const LEDGER_KIND_LABELS: Record<string, string> = {
  PAYMENT: "Pagamento",
  EFI_FEE: "Tarifa Efí",
  PLATFORM_FEE: "Remuneração CifraMais",
  REFUND: "Devolução",
  PLATFORM_FEE_REVERSAL: "Estorno da remuneração",
  DUPLICATE_PAYMENT: "Pagamento em duplicidade",
};

export interface CompanyReceipt {
  invoiceId: string;
  debtorName: string;
  billingMethod: string;
  paidAt: string | null;
  grossAmountCents: number;
  paidAmountCents: number;
  efiFeeCents: number;
  efiFeeEstimated: boolean;
  platformFeeCents: number;
  refundedCents: number;
  netCents: number;
  situation: "RECEIVED" | "IN_REVIEW" | "REFUNDED" | "PARTIALLY_REFUNDED";
}

export interface CompanyReceipts {
  totals: {
    receivedCents: number;
    efiFeeCents: number;
    platformFeeCents: number;
    refundedCents: number;
    platformFeeReversalCents: number;
    netCents: number;
  };
  total: number;
  page: number;
  pageSize: number;
  data: CompanyReceipt[];
}

export interface FinancialHistory {
  versions: Array<{
    id: string;
    version: number;
    status: string;
    origin: string;
    accountMode: string;
    payoutMode: string;
    environment: string;
    enabledMethods: string[];
    issuerAccount: string | null;
    credentialVersion: number | null;
    certificateExpiresAt: string | null;
    authorizationKind: string | null;
    authorizationReference: string | null;
    activatedAt: string | null;
    activatedBy: string | null;
    supersededAt: string | null;
    canceledAt: string | null;
    cancelReason: string | null;
    createdAt: string;
  }>;
  events: Array<{
    id: string;
    action: string;
    entityType: string;
    actor: string | null;
    createdAt: string;
    details?: unknown;
  }>;
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

// "1.234,56" or "1234.56" → cents; null when invalid.
export function parseMoneyToCents(value: string): number | null {
  const text = value.trim().replace(/\s|R\$/g, "");
  if (!text) return null;
  const normalized = text.includes(",")
    ? text.replace(/\./g, "").replace(",", ".")
    : text;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}
