/**
 * Shared contracts of the imported WhatsApp catalog: selection, mapping, versions and
 * decisions. HTTP DTOs mirror these types; Prisma rows are never exposed directly.
 */

export const TEMPLATE_PURPOSES = [
  'EMISSION',
  'BEFORE_DUE',
  'DUE_TODAY',
  'FIRST_OVERDUE',
  'RECURRING_OVERDUE',
  'CRITICAL_OVERDUE',
  'ACTIVATION_NOTICE',
  'ACTIVATION_REMINDER',
] as const;
export type TemplatePurpose = (typeof TEMPLATE_PURPOSES)[number];

/** Collection purposes a rule step may use; activation notices have their own. */
export const COLLECTION_PURPOSES: readonly TemplatePurpose[] = [
  'EMISSION',
  'BEFORE_DUE',
  'DUE_TODAY',
  'FIRST_OVERDUE',
  'RECURRING_OVERDUE',
  'CRITICAL_OVERDUE',
];

export type TemplateSelection =
  | { mode: 'EXPLICIT'; templateId: string }
  | { mode: 'DEFAULT'; purpose: TemplatePurpose }
  | { mode: 'UNCONFIGURED' };

export type TemplateContext = {
  companyId: string;
  debtorId?: string;
  invoiceId?: string;
  activationId?: string;
};

export const TEMPLATE_SOURCES = [
  'DEBTOR_NAME',
  'COMPANY_NAME',
  'AMOUNT',
  'DUE_DATE',
  'PAYMENT_LINK',
  'PIX_COPY_PASTE',
  'BOLETO_LINE',
  'BOLETO_LINK',
  'BOLETO_PDF',
  'REPRESENTATIVE_NAME',
] as const;
export type TemplateSource = (typeof TEMPLATE_SOURCES)[number];

/** Sources read from an invoice: a template using any of them needs the invoice context. */
export const INVOICE_SOURCES: readonly TemplateSource[] = [
  'AMOUNT',
  'DUE_DATE',
  'PAYMENT_LINK',
  'PIX_COPY_PASTE',
  'BOLETO_LINE',
  'BOLETO_LINK',
  'BOLETO_PDF',
];

export type TemplateBinding =
  | { kind: 'SOURCE'; source: TemplateSource }
  | { kind: 'LITERAL'; value: string };

export type TemplateMapping = {
  /**
   * Keys are the template's own variables: decimal positions ("1", "2") for positional
   * templates, the approved names ("nome_devedor") for named ones. Never database paths.
   */
  body: Record<string, TemplateBinding>;
  /** `index` is the payment button's position among the template's buttons. */
  paymentButton?: { index: number; source: 'PAYMENT_URL_SUFFIX' };
};

export type TemplateSnapshot = {
  templateId: string;
  providerRevision: number;
  mappingRevision: number;
  policyVersion: number;
  grantVersion: number;
};

export const TEMPLATE_BLOCK_CODES = [
  'DEFAULT_MISSING',
  'NOT_GRANTED',
  'NOT_APPROVED',
  'UNSUPPORTED',
  'REVIEW_REQUIRED',
  'VALUE_MISSING',
  'VERSION_CHANGED',
  'CONTEXT_CHANGED',
  'LEGACY_PAYLOAD',
  'SELECTION_MISSING',
] as const;
export type TemplateBlockCode = (typeof TEMPLATE_BLOCK_CODES)[number];

export type TemplateParameterFormat = 'POSITIONAL' | 'NAMED';

export type ParsedTemplate = {
  body: string;
  parameterFormat: TemplateParameterFormat;
  /** Mapping keys in send order: "1", "2"... or the names in order of first use. */
  variables: string[];
  footer: string | null;
  paymentButton: { index: number; label: string; url: string } | null;
  /** Static quick reply buttons: sent as approved, never parameterized. */
  quickReplies: string[];
  fingerprint: string;
};

export type ParseResult =
  | { supported: true; template: ParsedTemplate }
  | { supported: false; reason: string };

export type ReadyTemplate = {
  snapshot: TemplateSnapshot;
  name: string;
  language: string;
  parsed: ParsedTemplate;
  mapping: TemplateMapping;
};

export type TemplateDecision =
  | { allowed: true; template: ReadyTemplate }
  | { allowed: false; code: TemplateBlockCode };

export type RenderValues = Partial<Record<TemplateSource, string>>;

export type RenderResult =
  | {
      ok: true;
      body: string;
      bodyParameters: string[];
      /** Named templates only: the name of each body parameter, same order. */
      bodyParameterNames?: string[];
      paymentButtonSuffix?: string;
    }
  | { ok: false; code: 'VALUE_MISSING' | 'UNSUPPORTED'; field: string };

export type TemplateSendOrigin = 'COLLECTION' | 'ADMIN_REPLY' | 'ACTIVATION';

export type TemplateSendRequest = {
  logicalKey: string;
  origin: TemplateSendOrigin;
  context: TemplateContext;
  selection: TemplateSelection;
  ruleStepId?: string;
  conversationId?: string;
  replyToExternalMessageId?: string;
};

export type PendingInput = {
  request: TemplateSendRequest;
  code: TemplateBlockCode;
  intentId?: string;
  snapshot?: TemplateSnapshot;
};

export type PendingRef = {
  id: string;
  version: number;
  state: 'BLOCKED' | 'RESUMED' | 'CLOSED';
  currentIntentId: string | null;
};

export type ResumeItem = { pendingId: string; replacementTemplateId?: string };

export type ResumeReview = {
  id: string;
  expiresAt: string;
  items: Array<{
    pendingId: string;
    companyId: string;
    invoiceId: string | null;
    templateId: string | null;
    templateName: string | null;
    action: 'RESUME' | 'CLOSE' | 'KEEP_BLOCKED';
    reason: string | null;
    previewBody: string | null;
  }>;
};

export type ResumeResult = {
  reviewId: string;
  intentIds: string[];
  closedPendingIds: string[];
};

/** Typed refusal of the template policy; never answered with a fallback template. */
export class TemplatePolicyError extends Error {
  constructor(
    readonly code: TemplateBlockCode,
    message = code,
  ) {
    super(message);
    this.name = 'TemplatePolicyError';
  }
}

/** Bounds of body parameters accepted by the Datafy/Cloud API contract in use. */
export const TEMPLATE_PARAMETER_MAX_LENGTH = 1024;
export const TEMPLATE_MAX_BODY_PARAMETERS = 20;
export const TEMPLATE_LITERAL_MAX_LENGTH = 200;
