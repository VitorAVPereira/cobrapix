import { GlobalMessageTemplate, Prisma } from '@prisma/client';
import { isRecord } from '../whatsapp/transport/whatsapp-transport.error';

/** Named variables in order; each one is a positional parameter of the approved template. */
export function templateVariableNames(content: string): string[] {
  return Array.from(
    content.matchAll(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g),
    (match) => match[1] ?? '',
  );
}

export function templateBody(content: string): string {
  let index = 0;
  return content
    .replace(
      /\{([^{}|]+(?:\|[^{}|]+)+)\}/g,
      (_match: string, options: string) => options.split('|')[0]?.trim() ?? '',
    )
    .replace(/\{\{\s*[a-zA-Z][a-zA-Z0-9_]*\s*\}\}/g, () => `{{${++index}}}`);
}

export function templateCompatibility(
  local: Pick<
    GlobalMessageTemplate,
    | 'content'
    | 'footerText'
    | 'paymentButtonEnabled'
    | 'paymentButtonLabel'
    | 'copyCodeButtonEnabled'
  >,
  components: unknown,
): boolean {
  if (!Array.isArray(components)) return false;
  const parts = components.filter(isRecord);
  if (
    parts.length !== components.length ||
    parts.some(
      (item) => !['BODY', 'FOOTER', 'BUTTONS'].includes(String(item.type)),
    )
  )
    return false;
  const body = parts.filter((item) => item.type === 'BODY');
  if (body.length !== 1 || body[0]?.text !== templateBody(local.content))
    return false;
  const footer = parts.find((item) => item.type === 'FOOTER');
  if ((footer?.text ?? '') !== (local.footerText ?? '')) return false;
  const buttonPart = parts.find((item) => item.type === 'BUTTONS');
  const buttons: unknown[] =
    buttonPart && Array.isArray(buttonPart.buttons) ? buttonPart.buttons : [];
  if (
    buttons.length !==
    Number(local.paymentButtonEnabled) + Number(local.copyCodeButtonEnabled)
  )
    return false;
  if (local.paymentButtonEnabled) {
    const button = buttons[0];
    if (
      !isRecord(button) ||
      button.type !== 'URL' ||
      button.text !== local.paymentButtonLabel ||
      typeof button.url !== 'string' ||
      !/^https?:\/\/[^\s]+\/pagar\/\{\{1\}\}$/.test(button.url)
    )
      return false;
  }
  if (local.copyCodeButtonEnabled) return false; // The application's payment codes exceed COPY_CODE's supported size.
  return true;
}

export function templateEventUpdate(
  local: GlobalMessageTemplate,
  field: string,
  value: Record<string, unknown>,
): Prisma.GlobalMessageTemplateUpdateManyMutationInput {
  const update: Prisma.GlobalMessageTemplateUpdateManyMutationInput = {};
  if (field === 'message_template_status_update') {
    if (
      typeof value.event === 'string' &&
      [
        'APPROVED',
        'REJECTED',
        'PAUSED',
        'DISABLED',
        'PENDING',
        'IN_APPEAL',
        'DELETED',
        'PENDING_DELETION',
      ].includes(value.event)
    )
      update.metaStatus = value.event;
    else update.metaReviewRequired = true;
    if (typeof value.reason === 'string')
      update.metaRejectedReason =
        value.reason === 'NONE' ? null : value.reason.slice(0, 1000);
  }
  if (field === 'message_template_quality_update') {
    if (
      typeof value.new_quality_score === 'string' &&
      ['GREEN', 'YELLOW', 'RED', 'UNKNOWN'].includes(value.new_quality_score)
    )
      update.metaQuality = value.new_quality_score;
  }
  const category = value.new_category ?? value.message_template_category;
  if (typeof category === 'string') {
    update.metaProviderCategory = category.slice(0, 32);
    if (category !== local.category) update.metaReviewRequired = true;
  }
  if (field === 'message_template_components_update') {
    const components =
      value.components ??
      (typeof value.message_template_element === 'string'
        ? [{ type: 'BODY', text: value.message_template_element }]
        : null);
    if (components) update.metaComponents = components as Prisma.InputJsonValue;
    if (!templateCompatibility(local, components))
      update.metaReviewRequired = true;
  }
  return update;
}

export async function applyTemplateEvent(
  tx: Prisma.TransactionClient,
  field: string,
  value: Record<string, unknown>,
  timestamp: Date,
): Promise<boolean> {
  const name = value.message_template_name;
  const language = value.message_template_language;
  if (typeof name !== 'string' || typeof language !== 'string') return true;
  const fields = {
    message_template_status_update: 'metaStatusAt',
    message_template_quality_update: 'metaQualityAt',
    template_category_update: 'metaCategoryAt',
    message_template_components_update: 'metaComponentsAt',
  } as const;
  if (!(field in fields)) return true;
  const timeField = fields[field as keyof typeof fields];
  const templates = await tx.globalMessageTemplate.findMany({
    where: { metaTemplateName: name, metaLanguage: language },
  });
  for (const template of templates) {
    const data = templateEventUpdate(template, field, value);
    await tx.globalMessageTemplate.updateMany({
      where: {
        id: template.id,
        OR: [{ [timeField]: null }, { [timeField]: { lt: timestamp } }],
      },
      data: { ...data, [timeField]: timestamp, lastMetaSyncAt: new Date() },
    });
  }
  return templates.length === 0;
}
