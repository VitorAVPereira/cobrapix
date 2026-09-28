import type {
  WhatsappSelectionMode,
  WhatsappTemplatePurpose,
} from '@prisma/client';
import type { TemplatePurpose, TemplateSelection } from './template-contracts';

/** Logical key of a collection send, shared by producers, holds and queue retries. */
export function collectionLogicalKey(input: {
  companyId: string;
  invoiceId: string;
  ruleStepId?: string | null;
}): string {
  return `collection:${input.companyId}:${input.invoiceId}:${input.ruleStepId ?? 'initial'}:WHATSAPP`;
}

/** Persisted choice of a WhatsApp rule step; anything incomplete stays unconfigured. */
export function ruleStepSelection(step: {
  whatsappSelectionMode: WhatsappSelectionMode | null;
  whatsappPurpose: WhatsappTemplatePurpose | null;
  templateId: string | null;
}): TemplateSelection {
  if (step.whatsappSelectionMode === 'EXPLICIT' && step.templateId)
    return { mode: 'EXPLICIT', templateId: step.templateId };
  if (step.whatsappSelectionMode === 'DEFAULT' && step.whatsappPurpose)
    return { mode: 'DEFAULT', purpose: step.whatsappPurpose };
  return { mode: 'UNCONFIGURED' };
}

/** Commercial purpose of a rule step by its cumulative day relative to the due date. */
export function purposeForScheduleDay(day: number): TemplatePurpose {
  if (day <= -30) return 'EMISSION';
  if (day < 0) return 'BEFORE_DUE';
  if (day === 0) return 'DUE_TODAY';
  if (day <= 2) return 'FIRST_OVERDUE';
  if (day >= 30) return 'CRITICAL_OVERDUE';
  return 'RECURRING_OVERDUE';
}
