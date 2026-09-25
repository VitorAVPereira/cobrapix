import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  MessageRecipient,
  messageRecipient,
} from '../communications/message-context';
import { INTERACTIVE_TOKEN_PATTERN } from '../communications/communication-token.service';

export interface DatafyChannelIdentity {
  wabaId: string;
  phoneNumberId: string;
}
export interface DatafyMessageEvent {
  kind: 'MESSAGE';
  source: 'LIVE';
  externalMessageId: string;
  recipient: MessageRecipient;
  timestamp: Date;
  messageType: string;
  content: string;
  replyToExternalMessageId: string | null;
  /** Server-issued button reference; any other payload is discarded as untrusted. */
  interactiveToken: string | null;
  attachment?: { externalMediaId: string; contentType: string | null };
  optOut: boolean;
}
export interface DatafyStatusEvent {
  kind: 'STATUS';
  externalMessageId: string;
  recipient: MessageRecipient;
  timestamp: Date;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  errorCodes: string[];
}
export interface DatafyReviewEvent {
  kind: 'TEMPLATE' | 'IDENTITY' | 'HISTORY' | 'UNKNOWN';
  field?: string;
  value?: Record<string, unknown>;
  timestamp?: Date;
}
export type DatafyEvent =
  | DatafyMessageEvent
  | DatafyStatusEvent
  | DatafyReviewEvent;

export function isDatafyRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown, max = 65536): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    ? value
    : null;
}
function eventTime(value: unknown, now: number): Date | null {
  if (typeof value !== 'string' || !/^\d{10}$/.test(value)) return null;
  const milliseconds = Number(value) * 1000;
  return milliseconds >= 946684800000 && milliseconds <= now + 30_000
    ? new Date(milliseconds)
    : null;
}
function recipient(phone: unknown, opaque: unknown): MessageRecipient | null {
  try {
    if (typeof phone === 'string' && /^\+?\d{8,15}$/.test(phone))
      return messageRecipient({ type: 'PHONE', value: phone });
    if (typeof opaque === 'string')
      return messageRecipient({ type: 'BSUID', value: opaque });
  } catch {
    /* Authenticated but unusable identity is retained for review. */
  }
  return null;
}
export function normalizeWhatsAppMessage(
  value: unknown,
  now = Date.now(),
): DatafyEvent {
  if (!isDatafyRecord(value)) return { kind: 'UNKNOWN' };
  if (value.history_context !== undefined) return { kind: 'HISTORY' };
  const id = text(value.id, 512),
    timestamp = eventTime(value.timestamp, now);
  const contact = recipient(value.from, value.from_user_id);
  if (!id || !timestamp || !contact) return { kind: 'UNKNOWN' };
  const type = text(value.type, 64);
  const context = isDatafyRecord(value.context) ? value.context : {};
  let content: string | null = null;
  let reference: unknown = null;
  let attachment: DatafyMessageEvent['attachment'];
  if (type === 'text' && isDatafyRecord(value.text))
    content = text(value.text.body);
  else if (type === 'button' && isDatafyRecord(value.button)) {
    content = text(value.button.text);
    reference = value.button.payload;
  } else if (type === 'interactive' && isDatafyRecord(value.interactive)) {
    const reply =
      value.interactive.button_reply ?? value.interactive.list_reply;
    if (isDatafyRecord(reply)) {
      content = text(reply.title);
      reference = reply.id;
    }
  } else if (
    type &&
    ['image', 'audio', 'video', 'document', 'sticker'].includes(type)
  ) {
    const media = value[type];
    if (
      isDatafyRecord(media) &&
      typeof media.id === 'string' &&
      /^\d{1,64}$/.test(media.id)
    ) {
      attachment = {
        externalMediaId: media.id,
        contentType: text(media.mime_type, 255),
      };
      content = text(media.caption) ?? `[${type}]`;
    }
  } else if (
    type === 'location' ||
    type === 'contacts' ||
    type === 'reaction'
  ) {
    content = `[${type}]`;
  }
  if (!content || !type) return { kind: 'UNKNOWN' };
  return {
    kind: 'MESSAGE',
    source: 'LIVE',
    externalMessageId: id,
    recipient: contact,
    timestamp,
    messageType: type,
    content,
    replyToExternalMessageId: text(context.id, 512),
    interactiveToken:
      typeof reference === 'string' && INTERACTIVE_TOKEN_PATTERN.test(reference)
        ? reference
        : null,
    attachment,
    optOut:
      type === 'text' &&
      /^(STOP|SAIR|PARAR|CANCELAR)$/.test(content.trim().toUpperCase()),
  };
}
export function normalizeWhatsAppStatus(
  value: unknown,
  now = Date.now(),
): DatafyEvent {
  if (!isDatafyRecord(value)) return { kind: 'UNKNOWN' };
  const id = text(value.id, 512),
    timestamp = eventTime(value.timestamp, now);
  const contact = recipient(value.recipient_id, value.recipient_user_id);
  const status = value.status;
  if (
    !id ||
    !timestamp ||
    !contact ||
    (status !== 'sent' &&
      status !== 'delivered' &&
      status !== 'read' &&
      status !== 'failed')
  )
    return { kind: 'UNKNOWN' };
  const errorCodes = Array.isArray(value.errors)
    ? value.errors.flatMap((error: unknown) => {
        if (!isDatafyRecord(error)) return [];
        const code =
          typeof error.code === 'number' && Number.isSafeInteger(error.code)
            ? String(error.code)
            : error.code;
        return typeof code === 'string' && /^\d{1,12}$/.test(code)
          ? [code]
          : [];
      })
    : [];
  return {
    kind: 'STATUS',
    externalMessageId: id,
    recipient: contact,
    timestamp,
    status,
    errorCodes: [...new Set(errorCodes)].sort(),
  };
}

/** Validate EVERY channel before the request can be acknowledged, including mixed batches. */
export function normalizeDatafyEvents(
  payload: unknown,
  identity: DatafyChannelIdentity,
  now = Date.now(),
): DatafyEvent[] {
  if (
    !isDatafyRecord(payload) ||
    payload.object !== 'whatsapp_business_account' ||
    !Array.isArray(payload.entry) ||
    !payload.entry.length
  )
    throw new BadRequestException('Envelope Datafy invalido');
  const events: DatafyEvent[] = [];
  for (const entry of payload.entry as unknown[]) {
    if (!isDatafyRecord(entry) || entry.id !== identity.wabaId)
      throw new ForbiddenException('Canal Datafy desconhecido');
    if (!Array.isArray(entry.changes) || !entry.changes.length)
      throw new BadRequestException('Eventos Datafy invalidos');
    for (const change of entry.changes as unknown[]) {
      if (
        !isDatafyRecord(change) ||
        typeof change.field !== 'string' ||
        !isDatafyRecord(change.value)
      )
        throw new BadRequestException('Evento Datafy invalido');
      const { field, value } = change;
      const metadata = isDatafyRecord(value.metadata) ? value.metadata : null;
      const numberRequired = [
        'messages',
        'history',
        'smb_app_state_sync',
        'smb_message_echoes',
      ].includes(field);
      if (
        (numberRequired &&
          metadata?.phone_number_id !== identity.phoneNumberId) ||
        (metadata?.phone_number_id !== undefined &&
          metadata.phone_number_id !== identity.phoneNumberId)
      )
        throw new ForbiddenException('Canal Datafy desconhecido');
      if (field === 'messages') {
        const before = events.length;
        for (const item of Array.isArray(value.messages)
          ? (value.messages as unknown[])
          : [])
          events.push(normalizeWhatsAppMessage(item, now));
        for (const item of Array.isArray(value.statuses)
          ? (value.statuses as unknown[])
          : [])
          events.push(normalizeWhatsAppStatus(item, now));
        if (events.length === before) events.push({ kind: 'UNKNOWN' });
      } else if (
        field.startsWith('message_template_') ||
        field === 'template_category_update'
      )
        events.push({
          kind: 'TEMPLATE',
          field,
          value,
          timestamp: eventTime(entry.time, now) ?? new Date(now),
        });
      else if (field === 'history') events.push({ kind: 'HISTORY' });
      else if (field === 'smb_app_state_sync' || field === 'user_id_update')
        events.push({ kind: 'IDENTITY' });
      else events.push({ kind: 'UNKNOWN' });
      if (events.length > 1000)
        throw new BadRequestException('Lote Datafy excede o limite');
    }
  }
  return events;
}
