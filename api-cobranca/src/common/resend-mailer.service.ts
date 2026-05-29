import { Injectable } from '@nestjs/common';
import { Resend, type ErrorResponse, type WebhookEventPayload } from 'resend';

export interface SendResendEmailInput {
  apiKey: string;
  from: string;
  to: string[];
  subject: string;
  html: string;
}

export interface SendResendEmailResult {
  id: string;
}

export type ResendTemplateVariableInput =
  | {
      key: string;
      type: 'string';
      fallbackValue?: string | null;
    }
  | {
      key: string;
      type: 'number';
      fallbackValue?: number | null;
    };

export interface ResendTemplatePayload {
  apiKey: string;
  name: string;
  html: string;
  alias?: string;
  from?: string;
  subject?: string;
  text?: string;
  variables?: ResendTemplateVariableInput[];
}

export interface UpdateResendTemplatePayload extends ResendTemplatePayload {
  idOrAlias: string;
}

export interface ResendTemplateIdentifierInput {
  apiKey: string;
  idOrAlias: string;
}

export interface ResendTemplateMutationResult {
  id: string;
}

export interface DeleteResendTemplateResult extends ResendTemplateMutationResult {
  deleted: boolean;
}

export interface ResendTemplateRemote {
  id: string;
  name: string;
  alias: string | null;
  status: 'draft' | 'published';
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListResendTemplatesInput {
  apiKey: string;
  limit?: number;
  before?: string;
  after?: string;
}

export interface ResendWebhookHeaders {
  id?: string;
  timestamp?: string;
  signature?: string;
}

export interface VerifyResendWebhookInput {
  payload: string;
  headers: ResendWebhookHeaders;
  webhookSecret: string;
}

@Injectable()
export class ResendMailerService {
  async sendEmail(input: SendResendEmailInput): Promise<SendResendEmailResult> {
    const resend = new Resend(input.apiKey);
    const result = await resend.emails.send({
      from: input.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
    });

    if (result.error) {
      throw new Error(this.formatError(result.error));
    }

    const messageId = result.data?.id;
    if (!messageId) {
      throw new Error('Resend API: resposta sem ID de mensagem');
    }

    return { id: messageId };
  }

  async createTemplate(
    input: ResendTemplatePayload,
  ): Promise<ResendTemplateMutationResult> {
    const resend = new Resend(input.apiKey);
    const result = await resend.templates.create({
      name: input.name,
      html: input.html,
      ...(input.alias !== undefined && { alias: input.alias }),
      ...(input.from !== undefined && { from: input.from }),
      ...(input.subject !== undefined && { subject: input.subject }),
      ...(input.text !== undefined && { text: input.text }),
      ...(input.variables !== undefined && { variables: input.variables }),
    });

    if (result.error) {
      throw new Error(this.formatError(result.error));
    }

    const templateId = result.data?.id;
    if (!templateId) {
      throw new Error('Resend API: resposta sem ID de template');
    }

    return { id: templateId };
  }

  async updateTemplate(
    input: UpdateResendTemplatePayload,
  ): Promise<ResendTemplateMutationResult> {
    const resend = new Resend(input.apiKey);
    const result = await resend.templates.update(input.idOrAlias, {
      name: input.name,
      html: input.html,
      ...(input.alias !== undefined && { alias: input.alias }),
      ...(input.from !== undefined && { from: input.from }),
      ...(input.subject !== undefined && { subject: input.subject }),
      ...(input.text !== undefined && { text: input.text }),
      ...(input.variables !== undefined && { variables: input.variables }),
    });

    if (result.error) {
      throw new Error(this.formatError(result.error));
    }

    const templateId = result.data?.id;
    if (!templateId) {
      throw new Error('Resend API: resposta sem ID de template');
    }

    return { id: templateId };
  }

  async publishTemplate(
    input: ResendTemplateIdentifierInput,
  ): Promise<ResendTemplateMutationResult> {
    const resend = new Resend(input.apiKey);
    const result = await resend.templates.publish(input.idOrAlias);

    if (result.error) {
      throw new Error(this.formatError(result.error));
    }

    const templateId = result.data?.id;
    if (!templateId) {
      throw new Error('Resend API: resposta sem ID de template');
    }

    return { id: templateId };
  }

  async deleteTemplate(
    input: ResendTemplateIdentifierInput,
  ): Promise<DeleteResendTemplateResult> {
    const resend = new Resend(input.apiKey);
    const result = await resend.templates.remove(input.idOrAlias);

    if (result.error) {
      throw new Error(this.formatError(result.error));
    }

    const templateId = result.data?.id;
    if (!templateId) {
      throw new Error('Resend API: resposta sem ID de template');
    }

    return { id: templateId, deleted: Boolean(result.data?.deleted) };
  }

  async getTemplate(
    input: ResendTemplateIdentifierInput,
  ): Promise<ResendTemplateRemote> {
    const resend = new Resend(input.apiKey);
    const result = await resend.templates.get(input.idOrAlias);

    if (result.error) {
      throw new Error(this.formatError(result.error));
    }

    if (!result.data) {
      throw new Error('Resend API: resposta sem template');
    }

    return {
      id: result.data.id,
      name: result.data.name,
      alias: result.data.alias,
      status: result.data.status,
      publishedAt: result.data.published_at,
      createdAt: result.data.created_at,
      updatedAt: result.data.updated_at,
    };
  }

  async listTemplates(
    input: ListResendTemplatesInput,
  ): Promise<ResendTemplateRemote[]> {
    const resend = new Resend(input.apiKey);
    const result =
      input.before !== undefined
        ? await resend.templates.list({
            ...(input.limit !== undefined && { limit: input.limit }),
            before: input.before,
          })
        : input.after !== undefined
          ? await resend.templates.list({
              ...(input.limit !== undefined && { limit: input.limit }),
              after: input.after,
            })
          : await resend.templates.list(
              input.limit !== undefined ? { limit: input.limit } : undefined,
            );

    if (result.error) {
      throw new Error(this.formatError(result.error));
    }

    return (result.data?.data ?? []).map((template) => ({
      id: template.id,
      name: template.name,
      alias: template.alias,
      status: template.status,
      publishedAt: template.published_at,
      createdAt: template.created_at,
      updatedAt: template.updated_at,
    }));
  }

  verifyWebhookEvent(input: VerifyResendWebhookInput): WebhookEventPayload {
    const { id, timestamp, signature } = input.headers;

    if (!id || !timestamp || !signature) {
      throw new Error('Webhook Resend: assinatura ausente');
    }

    try {
      const resend = new Resend();
      return resend.webhooks.verify({
        payload: input.payload,
        headers: { id, timestamp, signature },
        webhookSecret: input.webhookSecret,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'assinatura invalida';
      throw new Error(`Webhook Resend: assinatura invalida: ${message}`);
    }
  }

  private formatError(error: ErrorResponse): string {
    const status = error.statusCode ?? 'sem-status';
    return `Resend API: falha (${status} ${error.name}): ${error.message}`;
  }
}

export function formatResendFromAddress(
  displayName: string,
  email: string,
): string {
  const normalizedName = displayName
    .replace(/[<>"\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const normalizedEmail = email.trim();

  return normalizedName
    ? `${normalizedName} <${normalizedEmail}>`
    : normalizedEmail;
}
