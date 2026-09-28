import { GlobalMessageTemplate, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

/** Named variables of a legacy internal template, in order. */
export function templateVariableNames(content: string): string[] {
  return Array.from(
    content.matchAll(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g),
    (match) => match[1] ?? '',
  );
}

/** Legacy internal text converted to the positional body submitted to the provider. */
export function templateBody(content: string): string {
  let index = 0;
  return content
    .replace(
      /\{([^{}|]+(?:\|[^{}|]+)+)\}/g,
      (_match: string, options: string) => options.split('|')[0]?.trim() ?? '',
    )
    .replace(/\{\{\s*[a-zA-Z][a-zA-Z0-9_]*\s*\}\}/g, () => `{{${++index}}}`);
}

export const PROVIDER_STATUSES = [
  'APPROVED',
  'REJECTED',
  'PAUSED',
  'DISABLED',
  'PENDING',
  'IN_APPEAL',
  'DELETED',
  'PENDING_DELETION',
  'LIMIT_EXCEEDED',
] as const;

/** Only a known approval can make a template eligible. */
export function isEligibleStatus(status: string | null | undefined): boolean {
  return status === 'APPROVED';
}

/**
 * Durable request for a full reconciliation of one WABA, written in the caller's
 * transaction. Keeps the earliest pending request; never performs HTTP.
 */
export async function requestTemplateSync(
  tx: Prisma.TransactionClient,
  providerAccountId: string,
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "WhatsappTemplateSyncState" ("id", "providerAccountId", "syncRequestedAt", "updatedAt")
    VALUES (${randomUUID()}, ${providerAccountId}, NOW(), NOW())
    ON CONFLICT ("providerAccountId") DO UPDATE
    SET "syncRequestedAt" = COALESCE("WhatsappTemplateSyncState"."syncRequestedAt", NOW()),
        "updatedAt" = NOW()`;
}

export interface TemplateEventChange {
  data: Prisma.GlobalMessageTemplateUpdateManyMutationInput;
  /** The event hints at content we did not receive in full: re-read the catalog. */
  reread: boolean;
}

/**
 * Local effect of one provider event. APPROVED never concludes a pending review, and a
 * partial content/category event restricts the template until the catalog is re-read.
 */
export function templateEventUpdate(
  local: Pick<GlobalMessageTemplate, 'metaStatus' | 'metaProviderCategory'>,
  field: string,
  value: Record<string, unknown>,
): TemplateEventChange {
  const data: Prisma.GlobalMessageTemplateUpdateManyMutationInput = {};
  let reread = false;
  let policyChanged = false;
  const restrict = () => {
    data.metaReviewRequired = true;
    policyChanged = true;
    reread = true;
  };
  if (field === 'message_template_status_update') {
    const status =
      typeof value.event === 'string' &&
      (PROVIDER_STATUSES as readonly string[]).includes(value.event)
        ? value.event
        : null;
    if (status) {
      data.metaStatus = status;
      if (isEligibleStatus(status) !== isEligibleStatus(local.metaStatus))
        policyChanged = true;
    } else restrict();
    if (typeof value.reason === 'string')
      data.metaRejectedReason =
        value.reason === 'NONE' ? null : value.reason.slice(0, 1000);
  }
  if (field === 'message_template_quality_update') {
    if (
      typeof value.new_quality_score === 'string' &&
      ['GREEN', 'YELLOW', 'RED', 'UNKNOWN'].includes(value.new_quality_score)
    )
      data.metaQuality = value.new_quality_score;
  }
  const category = value.new_category ?? value.message_template_category;
  if (typeof category === 'string') {
    const normalized = category.slice(0, 32).toUpperCase();
    if (normalized !== (local.metaProviderCategory ?? '').toUpperCase()) {
      data.metaProviderCategory = normalized;
      restrict();
    }
  }
  if (field === 'message_template_components_update') restrict();
  if (policyChanged) data.policyVersion = { increment: 1 };
  return { data, reread };
}

const EVENT_TIME_FIELDS = {
  message_template_status_update: 'metaStatusAt',
  message_template_quality_update: 'metaQualityAt',
  template_category_update: 'metaCategoryAt',
  message_template_components_update: 'metaComponentsAt',
} as const;

function providerTemplateId(value: Record<string, unknown>): string | null {
  const id = value.message_template_id;
  const text =
    typeof id === 'number' && Number.isSafeInteger(id) ? String(id) : id;
  return typeof text === 'string' && /^\d{1,64}$/.test(text) ? text : null;
}

/**
 * Applies a template event inside the webhook transaction. Templates are located within
 * the verified WABA by provider ID, or by name + language when the event has no ID; a
 * name alone never matches. An unknown template only requests a durable reconciliation.
 * Returns whether the delivery needs manual review.
 */
export async function applyTemplateEvent(
  tx: Prisma.TransactionClient,
  field: string,
  value: Record<string, unknown>,
  timestamp: Date,
  providerAccountId?: string,
): Promise<boolean> {
  if (!(field in EVENT_TIME_FIELDS) || !providerAccountId) return true;
  const timeField = EVENT_TIME_FIELDS[field as keyof typeof EVENT_TIME_FIELDS];
  const id = providerTemplateId(value);
  const name = value.message_template_name;
  const language = value.message_template_language;
  if (!id && (typeof name !== 'string' || typeof language !== 'string')) {
    await requestTemplateSync(tx, providerAccountId);
    return false;
  }
  const templates = await tx.globalMessageTemplate.findMany({
    where: {
      origin: 'META_IMPORTED',
      providerAccountId,
      ...(id
        ? { metaTemplateId: id }
        : {
            metaTemplateName: name as string,
            metaLanguage: language as string,
          }),
    },
    select: {
      id: true,
      metaStatus: true,
      metaProviderCategory: true,
    },
  });
  let reread = templates.length === 0;
  for (const template of templates) {
    const change = templateEventUpdate(template, field, value);
    const applied = await tx.globalMessageTemplate.updateMany({
      where: {
        id: template.id,
        OR: [{ [timeField]: null }, { [timeField]: { lt: timestamp } }],
      },
      data: {
        ...change.data,
        [timeField]: timestamp,
        stateVersion: { increment: 1 },
        lastMetaSyncAt: new Date(),
      },
    });
    if (applied.count)
      await tx.whatsappTemplateAudit.create({
        data: {
          templateId: template.id,
          action: 'PROVIDER_EVENT',
          details: {
            field,
            status: typeof value.event === 'string' ? value.event : null,
            reread: change.reread,
          },
        },
      });
    reread ||= change.reread;
  }
  if (reread) await requestTemplateSync(tx, providerAccountId);
  return false;
}
