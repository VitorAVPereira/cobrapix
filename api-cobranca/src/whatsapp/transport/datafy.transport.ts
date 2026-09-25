import { ConfigService } from '@nestjs/config';
import { DatafyRateLimitService } from './datafy-rate-limit.service';
import type {
  AcceptedMessage,
  ChannelInfo,
  CreatedTemplate,
  TemplateDefinition,
  TemplateMessage,
  TextMessage,
  TemplatePage,
  TemplateStatus,
  WhatsappTransport,
} from './whatsapp-transport';
import {
  configError,
  invalidResponse,
  isRecord,
  providerError,
  WhatsappTransportError,
} from './whatsapp-transport.error';

const ORIGIN = 'https://cloud.datafyapi.com.br';
const MEDIA_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Datafy (Graph-compatible WhatsApp Cloud API), the only WhatsApp transport.
 * Callers cannot supply an HTTP destination or authorization.
 */
export class DatafyTransport implements WhatsappTransport {
  readonly kind = 'DATAFY' as const;

  constructor(
    private readonly config: ConfigService,
    private readonly quota: DatafyRateLimitService,
  ) {}

  private id(key: string): string {
    return this.validateId(this.config.get<string>(key) ?? '');
  }

  private validateId(id: string): string {
    if (!/^\d{1,64}$/.test(id)) throw configError();
    return id;
  }

  private messageReference(id: string): string {
    if (!/^[A-Za-z0-9._=+/-]{1,512}$/.test(id)) throw configError();
    return id;
  }

  private apiPath(path: string): string {
    return `/v1${path}`;
  }

  async sendText(input: TextMessage): Promise<AcceptedMessage> {
    return this.send({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: input.to,
      ...(input.replyTo
        ? { context: { message_id: this.messageReference(input.replyTo) } }
        : {}),
      type: 'text',
      text: { preview_url: false, body: input.text },
    });
  }

  async sendTemplate(input: TemplateMessage): Promise<AcceptedMessage> {
    return this.send({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: input.to,
      type: 'template',
      template: {
        name: input.name,
        language: { code: input.language },
        components: input.components,
      },
    });
  }

  private async send(body: Record<string, unknown>): Promise<AcceptedMessage> {
    const payload = await this.json(
      this.apiPath(`/${this.id('META_PHONE_NUMBER_ID')}/messages`),
      'POST',
      body,
    );
    const first =
      isRecord(payload) && Array.isArray(payload.messages)
        ? (payload.messages[0] as unknown)
        : undefined;
    if (!isRecord(first) || typeof first.id !== 'string' || !first.id.trim())
      throw invalidResponse(true);
    return {
      accepted: true,
      messageId: first.id,
      status:
        typeof first.message_status === 'string' ? first.message_status : null,
    };
  }

  async createTemplate(input: TemplateDefinition): Promise<CreatedTemplate> {
    const payload = await this.json(
      this.apiPath(`/${this.id('META_BUSINESS_ACCOUNT_ID')}/message_templates`),
      'POST',
      input,
    );
    if (
      !isRecord(payload) ||
      typeof payload.id !== 'string' ||
      typeof payload.status !== 'string'
    )
      throw invalidResponse(true);
    return {
      id: payload.id,
      status: payload.status,
      ...(typeof payload.category === 'string'
        ? { category: payload.category }
        : {}),
    };
  }

  async listTemplates(after?: string): Promise<TemplatePage> {
    const cursor =
      after === undefined ? '' : `&after=${encodeURIComponent(after)}`;
    const payload = await this.json(
      this.apiPath(
        `/${this.id('META_BUSINESS_ACCOUNT_ID')}/message_templates?fields=id,name,language,status,rejected_reason,category,components,quality_score&limit=100${cursor}`,
      ),
    );
    if (!isRecord(payload) || !Array.isArray(payload.data))
      throw invalidResponse(false);
    const data: TemplateStatus[] = [];
    for (const item of payload.data as unknown[]) {
      if (!isRecord(item)) throw invalidResponse(false);
      data.push({
        id: typeof item.id === 'string' ? item.id : undefined,
        category: typeof item.category === 'string' ? item.category : undefined,
        components: Array.isArray(item.components)
          ? (item.components as unknown[])
          : undefined,
        quality_score:
          typeof item.quality_score === 'string'
            ? item.quality_score
            : isRecord(item.quality_score) &&
                typeof item.quality_score.score === 'string'
              ? item.quality_score.score
              : undefined,
        name: typeof item.name === 'string' ? item.name : undefined,
        language: typeof item.language === 'string' ? item.language : undefined,
        status: typeof item.status === 'string' ? item.status : undefined,
        rejected_reason:
          typeof item.rejected_reason === 'string'
            ? item.rejected_reason
            : undefined,
      });
    }
    const paging = isRecord(payload.paging) ? payload.paging : {};
    const cursors = isRecord(paging.cursors) ? paging.cursors : {};
    // Only the cursor is used; paging.next is never fetched or exposed.
    if (
      paging.next &&
      (typeof cursors.after !== 'string' ||
        !cursors.after ||
        cursors.after === after)
    )
      throw invalidResponse(false);
    return {
      data,
      ...(paging.next && typeof cursors.after === 'string'
        ? { after: cursors.after }
        : {}),
    };
  }

  /** Confirms via /me that the token belongs to the configured number and WABA. */
  async getChannelInfo(
    options: { includeMessagingLimit?: boolean } = {},
  ): Promise<ChannelInfo> {
    const phoneNumberId = this.id('META_PHONE_NUMBER_ID');
    const businessAccountId = this.id('META_BUSINESS_ACCOUNT_ID');
    const account = await this.json('/me');
    if (
      !isRecord(account) ||
      account.phone_number_id !== phoneNumberId ||
      account.waba_id !== businessAccountId
    )
      throw configError();
    const phone = options.includeMessagingLimit ? await this.phoneInfo() : {};
    return {
      phoneNumberId,
      businessAccountId,
      ...(typeof phone.messaging_limit_tier === 'string'
        ? { messagingLimitTier: phone.messaging_limit_tier }
        : {}),
    };
  }

  async downloadMedia(
    id: string,
  ): Promise<{ bytes: Buffer; contentType: string }> {
    return this.bytes(
      new URL(`/media/${this.validateId(id)}/download`, ORIGIN),
    );
  }

  private async phoneInfo(): Promise<Record<string, unknown>> {
    const id = this.id('META_PHONE_NUMBER_ID');
    const result = await this.json(
      this.apiPath(`/${id}?fields=id,messaging_limit_tier`),
    );
    if (!isRecord(result) || result.id !== id) throw configError();
    return result;
  }

  private async json(
    path: string,
    method: 'GET' | 'POST' = 'GET',
    body?: object,
  ): Promise<unknown> {
    const response = await this.request(new URL(path, ORIGIN), method, body);
    try {
      return (await response.json()) as unknown;
    } catch {
      throw invalidResponse(method === 'POST');
    }
  }

  private validateDestination(url: URL): void {
    if (
      url.origin !== ORIGIN ||
      url.username ||
      url.password ||
      url.hash ||
      url.searchParams.has('access_token')
    )
      throw configError();
  }

  /** GETs are retried briefly on rate limit or temporary errors; POSTs never. */
  private async request(
    url: URL,
    method: 'GET' | 'POST',
    body?: object,
  ): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.requestOnce(url, method, body);
      } catch (error: unknown) {
        if (
          method !== 'GET' ||
          attempt >= 2 ||
          !(error instanceof WhatsappTransportError) ||
          !['RATE_LIMIT', 'TEMPORARY'].includes(error.kind)
        )
          throw error;
        const wait = (error.retryAfterSeconds ?? 2 ** attempt) * 1000;
        if (wait > 5000) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, wait));
      }
    }
  }

  private async requestOnce(
    url: URL,
    method: 'GET' | 'POST',
    body?: object,
  ): Promise<Response> {
    this.validateDestination(url);
    const token = this.config.get<string>('DATAFY_API_TOKEN')?.trim();
    if (!token || /[\r\n]/.test(token)) throw configError();
    await this.quota.acquire(token, requestCategory(url, method));
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw invalidResponse(method === 'POST');
    }
    if (!response.ok) {
      let payload: unknown;
      try {
        payload = (await response.json()) as unknown;
      } catch {
        payload = null;
      }
      throw providerError(
        response.status,
        payload,
        method === 'POST',
        response.headers.get('retry-after'),
      );
    }
    return response;
  }

  private async bytes(
    url: URL,
  ): Promise<{ bytes: Buffer; contentType: string }> {
    const response = await this.request(url, 'GET');
    const tooLarge = (): WhatsappTransportError =>
      new WhatsappTransportError(
        'Midia excede o tamanho permitido.',
        'REJECTED',
        'NOT_SENT',
        undefined,
        undefined,
        undefined,
        'MEDIA_TOO_LARGE',
      );
    if (Number(response.headers.get('content-length')) > MEDIA_MAX_BYTES) {
      await response.body?.cancel();
      throw tooLarge();
    }
    if (!response.body) throw invalidResponse(false);
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MEDIA_MAX_BYTES) {
          await reader.cancel();
          throw tooLarge();
        }
        chunks.push(Buffer.from(chunk.value));
      }
    } catch (error: unknown) {
      if (error instanceof WhatsappTransportError) throw error;
      throw invalidResponse(false);
    } finally {
      reader.releaseLock();
    }
    return {
      bytes: Buffer.concat(chunks),
      contentType:
        response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }
}

function requestCategory(
  url: URL,
  method: 'GET' | 'POST',
): 'SEND' | 'UPLOAD' | 'OTHER' {
  if (method !== 'POST') return 'OTHER';
  if (/^\/v1\/\d+\/messages$/.test(url.pathname)) return 'SEND';
  if (/^\/v1\/\d+\/media$/.test(url.pathname)) return 'UPLOAD';
  return 'OTHER';
}
