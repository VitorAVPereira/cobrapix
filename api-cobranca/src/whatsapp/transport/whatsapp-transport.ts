export const WHATSAPP_TRANSPORT = Symbol('WHATSAPP_TRANSPORT');
// Persisted rows may still say META_DIRECT (history); new traffic is always DATAFY.
export type WhatsappTransportKind = 'DATAFY';

export interface AcceptedMessage {
  accepted: true;
  messageId: string;
  status: string | null;
}

export interface TextMessage {
  to: string;
  text: string;
  /** Provider ID of the message being quoted, from the same channel. */
  replyTo?: string;
}

export interface TemplateMessage {
  to: string;
  name: string;
  language: string;
  components?: ReadonlyArray<Record<string, unknown>>;
}

export interface TemplateStatus {
  id?: string;
  category?: string;
  components?: unknown[];
  quality_score?: string;
  name?: string;
  language?: string;
  status?: string;
  rejected_reason?: string;
  /** POSITIONAL or NAMED when the provider reports it; absent means positional. */
  parameter_format?: string;
}

export interface TemplatePage {
  data: TemplateStatus[];
  after?: string;
}

export interface ChannelInfo {
  phoneNumberId: string;
  businessAccountId: string;
  messagingLimitTier?: string;
}

export interface WhatsappTransport {
  readonly kind: WhatsappTransportKind;
  sendText(input: TextMessage): Promise<AcceptedMessage>;
  sendTemplate(input: TemplateMessage): Promise<AcceptedMessage>;
  listTemplates(after?: string): Promise<TemplatePage>;
  getChannelInfo(options?: {
    includeMessagingLimit?: boolean;
  }): Promise<ChannelInfo>;
  downloadMedia(id: string): Promise<{ bytes: Buffer; contentType: string }>;
}
