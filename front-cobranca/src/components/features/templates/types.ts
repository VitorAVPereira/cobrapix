/**
 * Presentation contracts of the imported WhatsApp catalog. They mirror the backend DTOs
 * (admin catalog, mapping, grants and defaults); content is always the approved one and
 * is never edited here.
 */

export const TEMPLATE_PURPOSES = [
  "EMISSION",
  "BEFORE_DUE",
  "DUE_TODAY",
  "FIRST_OVERDUE",
  "RECURRING_OVERDUE",
  "CRITICAL_OVERDUE",
  "ACTIVATION_NOTICE",
  "ACTIVATION_REMINDER",
  "DISBURSEMENT_APPROVAL",
  "DISBURSEMENT_EXPIRED",
  "DISBURSEMENT_FAILED",
] as const;
export type TemplatePurpose = (typeof TEMPLATE_PURPOSES)[number];

export const PURPOSE_LABELS: Record<TemplatePurpose, string> = {
  EMISSION: "Emissão da cobrança",
  BEFORE_DUE: "Antes do vencimento",
  DUE_TODAY: "No dia do vencimento",
  FIRST_OVERDUE: "Primeiro aviso de atraso",
  RECURRING_OVERDUE: "Atraso recorrente",
  CRITICAL_OVERDUE: "Atraso crítico",
  ACTIVATION_NOTICE: "Aviso de ativação financeira",
  ACTIVATION_REMINDER: "Lembrete de ativação financeira",
  DISBURSEMENT_APPROVAL: "Pagamento a colaboradores: pedido de aprovação",
  DISBURSEMENT_EXPIRED: "Pagamento a colaboradores: lote expirado",
  DISBURSEMENT_FAILED: "Pagamento a colaboradores: falhas no lote",
};

export const TEMPLATE_SOURCES = [
  "DEBTOR_NAME",
  "COMPANY_NAME",
  "AMOUNT",
  "DUE_DATE",
  "PAYMENT_LINK",
  "PIX_COPY_PASTE",
  "BOLETO_LINE",
  "BOLETO_LINK",
  "BOLETO_PDF",
  "REPRESENTATIVE_NAME",
  "APPROVER_NAME",
  "DISBURSEMENT_REFERENCE",
  "DISBURSEMENT_COUNT",
  "DISBURSEMENT_TOTAL",
  "DISBURSEMENT_EXPIRES_AT",
  "DISBURSEMENT_FAILURE_COUNT",
  "DISBURSEMENT_FAILURES",
] as const;
export type TemplateSource = (typeof TEMPLATE_SOURCES)[number];

export const SOURCE_LABELS: Record<TemplateSource, string> = {
  DEBTOR_NAME: "Nome do devedor",
  COMPANY_NAME: "Nome da empresa",
  AMOUNT: "Valor da cobrança",
  DUE_DATE: "Data de vencimento",
  PAYMENT_LINK: "Link de pagamento",
  PIX_COPY_PASTE: "Pix copia e cola",
  BOLETO_LINE: "Linha digitável do boleto",
  BOLETO_LINK: "Link do boleto",
  BOLETO_PDF: "PDF do boleto",
  REPRESENTATIVE_NAME: "Nome do representante",
  APPROVER_NAME: "Nome do aprovador (pagamentos)",
  DISBURSEMENT_REFERENCE: "Referência do lote de pagamentos",
  DISBURSEMENT_COUNT: "Quantidade de pagamentos do lote",
  DISBURSEMENT_TOTAL: "Total do lote de pagamentos",
  DISBURSEMENT_EXPIRES_AT: "Validade do pedido de aprovação",
  DISBURSEMENT_FAILURE_COUNT: "Quantidade de pagamentos com falha",
  DISBURSEMENT_FAILURES: "Pagamentos com falha e motivos",
};

export type TemplateBinding =
  | { kind: "SOURCE"; source: TemplateSource }
  | { kind: "LITERAL"; value: string };

export interface TemplateMapping {
  body: Record<string, TemplateBinding>;
  paymentButton?: { index: number; source: "PAYMENT_URL_SUFFIX" };
  pixButton?: { index: number; source: "PIX_COPY_PASTE" };
  boletoButton?: { index: number; source: "BOLETO_LINE" };
  /** Collaborator payments: positions among the quick replies of approve and refuse. */
  decisionButtons?: { approve: number; reject: number };
}

export type TemplateBlockCode =
  | "DEFAULT_MISSING"
  | "NOT_GRANTED"
  | "NOT_APPROVED"
  | "UNSUPPORTED"
  | "REVIEW_REQUIRED"
  | "VALUE_MISSING"
  | "VERSION_CHANGED"
  | "CONTEXT_CHANGED"
  | "LEGACY_PAYLOAD"
  | "SELECTION_MISSING"
  | "COLLECTION_TEMPLATE_MISSING";

export const BLOCK_LABELS: Record<TemplateBlockCode, string> = {
  DEFAULT_MISSING: "Sem template padrão para a finalidade",
  NOT_GRANTED: "Não liberado para a empresa",
  NOT_APPROVED: "Sem aprovação da Meta",
  UNSUPPORTED: "Formato não suportado",
  REVIEW_REQUIRED: "Variáveis precisam de revisão",
  VALUE_MISSING: "Faltam dados para preencher as variáveis",
  VERSION_CHANGED: "Configuração alterada depois do agendamento",
  CONTEXT_CHANGED: "Dados da cobrança mudaram",
  LEGACY_PAYLOAD: "Envio anterior à nova política",
  SELECTION_MISSING: "Etapa sem template escolhido",
  COLLECTION_TEMPLATE_MISSING:
    "Sem template da régua para o momento e a forma de pagamento",
};

export interface TemplateContentView {
  body: string;
  footer: string | null;
  /** `index`: the payment button's position among the template's buttons. */
  button: { label: string; url: string; index?: number } | null;
  /** "Copy Pix code" button: always carries the Pix code of the invoice sent. */
  pixButton?: { label: string; index: number } | null;
  /** "Copy Boleto code" button: always carries the digitable line of the invoice sent. */
  boletoButton?: { label: string; index: number } | null;
  /** Static quick reply buttons, sent as approved. */
  quickReplies?: string[];
}

export interface Readiness {
  ready: boolean;
  code: TemplateBlockCode | null;
}

export interface CatalogPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** Template lists also return how many items match, for numbered pages. */
export type CountedCatalogPage<T> = CatalogPage<T> & { total: number };

export type AdminCatalogStatus = "APPROVED" | "UNAVAILABLE" | "ALL";

export interface AdminCatalogQuery {
  status?: AdminCatalogStatus;
  supported?: boolean;
  search?: string;
  cursor?: string;
  limit?: number;
}

export interface AdminWhatsappTemplate {
  id: string;
  name: string;
  language: string;
  category: string | null;
  status: string;
  quality: string | null;
  rejectedReason: string | null;
  supported: boolean;
  supportReason: string | null;
  reviewRequired: boolean;
  archivedAt: string | null;
  providerRevision: number;
  mappingRevision: number;
  policyVersion: number;
  readiness: Readiness;
  /** POSITIONAL ({{1}}) or NAMED ({{nome_devedor}}), as approved in the Meta. */
  parameterFormat: string;
  /** Variables the admin maps: "1", "2"... or the approved names. */
  variables: string[];
  content: TemplateContentView;
  mapping: TemplateMapping | null;
  grantedCompanies: number;
  lastSyncAt: string | null;
}

export interface WhatsappSyncState {
  providerAccountId: string | null;
  lastCompletedAt: string | null;
  lastStartedAt: string | null;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  running: boolean;
  pendingRequest: boolean;
}

export interface WhatsappSyncResult {
  imported: number;
  updated: number;
  unavailable: number;
  completed: boolean;
  incomplete: number;
  conflicts: number;
}

export interface SaveTemplateMappingInput {
  expectedProviderRevision: number;
  expectedMappingRevision: number;
  mapping: TemplateMapping;
}

export type TemplateRenderResult =
  | {
      ok: true;
      body: string;
      bodyParameters: string[];
      paymentButtonSuffix?: string;
    }
  | { ok: false; code: "VALUE_MISSING" | "UNSUPPORTED"; field: string };

export interface CompanyTemplateGrant {
  templateId: string;
  templateName: string;
  language: string;
  enabled: boolean;
  version: number;
  available: Readiness;
}

export interface CompanyTemplateDefault {
  purpose: TemplatePurpose;
  templateId: string | null;
  templateName: string | null;
  version: number;
  available: Readiness;
}

export interface CompanyTemplateAccess {
  companyId: string;
  grants: CompanyTemplateGrant[];
  defaults: CompanyTemplateDefault[];
}

export interface SetTemplateGrantInput {
  enabled: boolean;
  /** 0 when the company has no record for this template yet. */
  expectedVersion: number;
}

export interface SetTemplateDefaultInput {
  /** null clears the purpose default. */
  templateId: string | null;
  expectedVersion: number;
}

/** The six collection moments: each has one global template per payment method. */
export const COLLECTION_PURPOSES = [
  "EMISSION",
  "BEFORE_DUE",
  "DUE_TODAY",
  "FIRST_OVERDUE",
  "RECURRING_OVERDUE",
  "CRITICAL_OVERDUE",
] as const satisfies readonly TemplatePurpose[];

export type CollectionPurpose = (typeof COLLECTION_PURPOSES)[number];

/** Names of the collection moments as the company reads them. */
export const MOMENT_LABELS: Record<CollectionPurpose, string> = {
  EMISSION: "Emissão",
  BEFORE_DUE: "Lembrete",
  DUE_TODAY: "Vence hoje",
  FIRST_OVERDUE: "Primeiro atraso",
  RECURRING_OVERDUE: "Atraso recorrente",
  CRITICAL_OVERDUE: "Atraso crítico",
};

/** When each moment is used, in the words of the collection rules. */
export const MOMENT_HINTS: Record<CollectionPurpose, string> = {
  EMISSION: "Enviado no cadastro da fatura, quando o envio imediato é pedido.",
  BEFORE_DUE: "Enviado antes do vencimento.",
  DUE_TODAY: "Enviado no dia do vencimento.",
  FIRST_OVERDUE: "Primeira mensagem após o vencimento de uma fatura avulsa.",
  RECURRING_OVERDUE: "Mensagens após o vencimento de uma fatura recorrente.",
  CRITICAL_OVERDUE:
    "Mensagens seguintes após o vencimento de uma fatura avulsa.",
};

export const COLLECTION_SLOT_METHODS = ["PIX", "BOLIX", "CREDIT_CARD"] as const;
export type CollectionSlotMethod = (typeof COLLECTION_SLOT_METHODS)[number];

export const SLOT_METHOD_LABELS: Record<CollectionSlotMethod, string> = {
  PIX: "Pix",
  BOLIX: "Bolix",
  CREDIT_CARD: "Cartão",
};

export interface CollectionTemplateSlot {
  purpose: CollectionPurpose;
  billingMethod: CollectionSlotMethod;
  templateId: string | null;
  templateName: string | null;
  /** 0 while the slot was never saved. */
  version: number;
  available: Readiness;
}

export interface CollectionTemplateSlots {
  slots: CollectionTemplateSlot[];
  /** Approved, ready templates that fit each method. */
  options: Record<
    CollectionSlotMethod,
    Array<{ id: string; name: string; language: string }>
  >;
}

/** "Dia do vencimento", "3 dias antes do vencimento", "5 dias após o vencimento". */
export function scheduleDayLabel(day: number): string {
  if (day === 0) return "Dia do vencimento";
  const count = Math.abs(day);
  const unit = count === 1 ? "dia" : "dias";
  return day < 0
    ? `${count} ${unit} antes do vencimento`
    : `${count} ${unit} após o vencimento`;
}

/** A collection template as the company sees it: approved content and a fictitious preview. */
export interface CollectionTemplateView {
  name: string;
  content: TemplateContentView;
  previewBody: string | null;
}

export interface CompanyCollectionTemplates {
  /** The 18 global templates; null while the platform has not configured one. */
  moments: Array<{
    purpose: CollectionPurpose;
    billingMethod: CollectionSlotMethod;
    template: CollectionTemplateView | null;
  }>;
  /** Custom templates linked to the company's steps after support requests. */
  custom: Array<{
    ruleStepId: string;
    profileName: string;
    scheduleDay: number;
    billingMethod: CollectionSlotMethod;
    template: CollectionTemplateView | null;
  }>;
}

export type TemplateRequestStatus = "OPEN" | "IN_PROGRESS" | "DONE" | "REJECTED";

export const REQUEST_STATUS_LABELS: Record<TemplateRequestStatus, string> = {
  OPEN: "Recebido",
  IN_PROGRESS: "Em andamento",
  DONE: "Concluído",
  REJECTED: "Não atendido",
};

export interface TemplateRequest {
  id: string;
  ruleStepId: string | null;
  purpose: CollectionPurpose | null;
  billingMethod: CollectionSlotMethod | null;
  message: string;
  status: TemplateRequestStatus;
  adminNote: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Admin listing only. */
  companyId?: string;
  companyName?: string;
}

export interface CreateTemplateRequestInput {
  ruleStepId?: string;
  purpose?: CollectionPurpose;
  billingMethod?: CollectionSlotMethod;
  message: string;
}

/** WhatsApp step of a company, as the admin links custom templates to it. */
export interface CompanyCollectionStep {
  ruleStepId: string;
  profileId: string;
  profileName: string;
  scheduleDay: number;
  customTemplates: Array<{
    billingMethod: CollectionSlotMethod;
    templateId: string;
    templateName: string;
  }>;
}

/** What a company reads: approved content, no mapping, grants or diagnostics. */
export interface CompanyWhatsappTemplate {
  id: string;
  name: string;
  language: string;
  category: string | null;
  content: TemplateContentView;
  defaultFor: TemplatePurpose[];
}

export const STATUS_LABELS: Record<string, string> = {
  PENDING: "Em análise",
  IN_APPEAL: "Em recurso",
  APPROVED: "Aprovado",
  REJECTED: "Rejeitado",
  PAUSED: "Pausado",
  DISABLED: "Desativado",
  PENDING_DELETION: "Exclusão pendente",
  DELETED: "Excluído",
  ARCHIVED: "Arquivado",
  LIMIT_EXCEEDED: "Limite excedido",
};

/** A 409 from a versioned write: someone else changed what the admin was looking at. */
export function isConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { status?: unknown }).status === 409
  );
}

export function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export type PendingState = "BLOCKED" | "RESUMED" | "CLOSED";

/** A held WhatsApp send. Admin rows add company and template; company rows never do. */
export interface TemplatePendingSend {
  id: string;
  origin: "COLLECTION" | "ADMIN_REPLY" | "ACTIVATION";
  invoiceId: string | null;
  code: TemplateBlockCode;
  state: PendingState;
  version: number;
  occurrences: number;
  blockedAt: string;
  resolvedAt: string | null;
  closedReason: string | null;
  companyId?: string;
  companyName?: string;
  templateId?: string | null;
  templateName?: string | null;
  ruleStepId?: string | null;
}

export interface TemplatePendingQuery {
  companyId?: string;
  templateId?: string;
  code?: TemplateBlockCode;
  state?: PendingState;
  cursor?: string;
  limit?: number;
}

export interface ResumeItem {
  pendingId: string;
  /** Explicit change of template decided by the admin; limited to granted ones. */
  replacementTemplateId?: string;
}

export type ResumeAction = "RESUME" | "CLOSE" | "KEEP_BLOCKED";

export interface ResumeReview {
  id: string;
  expiresAt: string;
  items: Array<{
    pendingId: string;
    companyId: string;
    invoiceId: string | null;
    templateId: string | null;
    templateName: string | null;
    action: ResumeAction;
    reason: string | null;
    previewBody: string | null;
  }>;
}

export interface ResumeResult {
  reviewId: string;
  intentIds: string[];
  closedPendingIds: string[];
}

export const ORIGIN_LABELS: Record<TemplatePendingSend["origin"], string> = {
  COLLECTION: "Régua de cobrança",
  ADMIN_REPLY: "Resposta do atendimento",
  ACTIVATION: "Aviso de ativação",
};

export const PENDING_STATE_LABELS: Record<PendingState, string> = {
  BLOCKED: "Bloqueado",
  RESUMED: "Retomada autorizada",
  CLOSED: "Encerrado",
};

/** Reasons of a review item: block codes plus the resume-specific outcomes. */
export function resumeReasonLabel(reason: string | null): string | null {
  if (!reason) return null;
  const labels: Record<string, string> = {
    ALREADY_SENT:
      "A mensagem já foi aceita pelo provedor; nada será reenviado.",
    TRANSMISSION_UNKNOWN:
      "Há um envio em andamento ou incerto; não é possível retomar agora.",
    INVOICE_NOT_PENDING:
      "A cobrança não está mais pendente; será encerrada sem mensagem.",
    OPT_IN_MISSING: "O devedor não autorizou mensagens por WhatsApp.",
    ACTIVATION_UNAVAILABLE: "A ativação não precisa mais deste aviso.",
    PENDING_RESUMED: "Esta pendência já teve a retomada autorizada.",
    PENDING_CLOSED: "Esta pendência já foi encerrada.",
  };
  return labels[reason] ?? BLOCK_LABELS[reason as TemplateBlockCode] ?? reason;
}
