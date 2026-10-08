import type {
  BillingMethod,
  WhatsappSelectionMode,
  WhatsappTemplatePurpose,
} from '@prisma/client';
import type {
  TemplatePurpose,
  TemplateSelection,
  TemplateSendRequest,
} from './template-contracts';

/** Cumulative day of the rule's "Inicial" steps: the first message of the charge. */
export const EMISSION_SCHEDULE_DAY = -30;

/** Logical key of a collection send, shared by producers, holds and queue retries. */
export function collectionLogicalKey(input: {
  companyId: string;
  invoiceId: string;
  ruleStepId?: string | null;
}): string {
  return `collection:${input.companyId}:${input.invoiceId}:${input.ruleStepId ?? 'initial'}:WHATSAPP`;
}

/** First message of the charge, automatic ("initial") or requested ("selected-<id>"). */
export function isInitialChargeKey(logicalKey: string | null): boolean {
  return /^collection:[^:]+:[^:]+:(initial|selected-[^:]+):WHATSAPP$/.test(
    logicalKey ?? '',
  );
}

/** Template of a WhatsApp rule step for each billing method; null keeps the step's choice. */
export type MethodTemplates = Partial<Record<BillingMethod, string | null>>;

export function stepMethodTemplates(step: {
  pixTemplateId?: string | null;
  boletoTemplateId?: string | null;
  bolixTemplateId?: string | null;
  cardTemplateId?: string | null;
}): MethodTemplates {
  return {
    PIX: step.pixTemplateId ?? null,
    BOLETO: step.boletoTemplateId ?? null,
    BOLIX: step.bolixTemplateId ?? null,
    CREDIT_CARD: step.cardTemplateId ?? null,
  };
}

/** The step's template for the charge's billing method, else the step's own choice. */
export function selectionForMethod(
  base: TemplateSelection,
  methodTemplates: MethodTemplates | undefined,
  billingMethod: BillingMethod | null | undefined,
): TemplateSelection {
  const templateId = billingMethod ? methodTemplates?.[billingMethod] : null;
  return templateId ? { mode: 'EXPLICIT', templateId } : base;
}

/** Persisted choice of a WhatsApp rule step; anything incomplete stays unconfigured. */
export function ruleStepSelection(
  step: {
    whatsappSelectionMode: WhatsappSelectionMode | null;
    whatsappPurpose: WhatsappTemplatePurpose | null;
    templateId: string | null;
    pixTemplateId?: string | null;
    boletoTemplateId?: string | null;
    bolixTemplateId?: string | null;
    cardTemplateId?: string | null;
  },
  billingMethod?: BillingMethod | null,
): TemplateSelection {
  let base: TemplateSelection = { mode: 'UNCONFIGURED' };
  if (step.whatsappSelectionMode === 'EXPLICIT' && step.templateId)
    base = { mode: 'EXPLICIT', templateId: step.templateId };
  else if (step.whatsappSelectionMode === 'DEFAULT' && step.whatsappPurpose)
    base = { mode: 'DEFAULT', purpose: step.whatsappPurpose };
  return selectionForMethod(base, stepMethodTemplates(step), billingMethod);
}

/** Commercial purpose of a rule step by its cumulative day relative to the due date. */
export function purposeForScheduleDay(day: number): TemplatePurpose {
  if (day <= EMISSION_SCHEDULE_DAY) return 'EMISSION';
  if (day < 0) return 'BEFORE_DUE';
  if (day === 0) return 'DUE_TODAY';
  if (day <= 2) return 'FIRST_OVERDUE';
  if (day >= 30) return 'CRITICAL_OVERDUE';
  return 'RECURRING_OVERDUE';
}

/**
 * Hold request of a template intent prepared before the catalog change. It carries no
 * choice: the admin decides the template when reviewing it.
 */
export function legacyTemplateRequest(
  intent: {
    logicalKey: string | null;
    idempotencyKey: string;
    companyId: string;
    invoiceId: string | null;
    debtorId: string | null;
  },
  payload: { origin?: string; invoiceId?: string; ruleStepId?: string },
): TemplateSendRequest {
  return {
    logicalKey: intent.logicalKey ?? intent.idempotencyKey,
    origin:
      payload.origin === 'ADMIN_REPLY'
        ? 'ADMIN_REPLY'
        : payload.invoiceId
          ? 'COLLECTION'
          : 'ACTIVATION',
    context: {
      companyId: intent.companyId,
      ...(intent.invoiceId ? { invoiceId: intent.invoiceId } : {}),
      ...(intent.debtorId ? { debtorId: intent.debtorId } : {}),
    },
    selection: { mode: 'UNCONFIGURED' },
    ...(payload.ruleStepId ? { ruleStepId: payload.ruleStepId } : {}),
  };
}
