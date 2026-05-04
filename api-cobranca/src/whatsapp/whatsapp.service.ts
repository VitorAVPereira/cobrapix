import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MessageTemplate, WhatsAppTemplateCategory } from '@prisma/client';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigureMetaWhatsappDto } from './dto/configure-meta-whatsapp.dto';

interface MetaPhoneNumberProfile {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
}

interface MetaMessageResponse {
  messaging_product: 'whatsapp';
  contacts?: Array<{
    input: string;
    wa_id: string;
  }>;
  messages: Array<{
    id: string;
    message_status?: string;
  }>;
}

interface MetaTemplateResponse {
  id: string;
  status: string;
  category?: string;
}

interface SendTemplateMessageInput {
  companyId: string;
  phoneNumber: string;
  templateName: string;
  languageCode: string;
  bodyParameters: string[];
}

interface SendTextMessageInput {
  companyId: string;
  phoneNumber: string;
  text: string;
}

interface CreateOfficialTemplateInput {
  companyId: string;
  template: Pick<
    MessageTemplate,
    'id' | 'slug' | 'content' | 'metaTemplateName' | 'metaLanguage' | 'category'
  >;
}

interface OfficialTemplatePayload {
  name: string;
  language: string;
  category: WhatsAppTemplateCategory;
  text: string;
  examples: string[];
}

const TEMPLATE_EXAMPLES: Record<string, string> = {
  nome_devedor: 'Joao Silva',
  nome_empresa: 'Empresa Teste MVP',
  valor: 'R$ 150,50',
  data_vencimento: '01/12/2026',
  metodo_pagamento: 'PIX',
  payment_link: '00020101021226860014br.gov.bcb.pix2564qrcodepix.example',
  pix_copia_e_cola: '00020101021226860014br.gov.bcb.pix2564qrcodepix.example',
  boleto_linha_digitavel:
    '34191.79001 01043.510047 91020.150008 1 98760000015050',
  boleto_link: 'https://cobranca.exemplo/boleto',
  boleto_pdf: 'https://cobranca.exemplo/boleto.pdf',
};

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly graphBaseUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly crypto: PaymentCryptoService,
  ) {
    const version = this.configService.get<string>(
      'META_GRAPH_API_VERSION',
      'v23.0',
    );
    this.graphBaseUrl = `https://graph.facebook.com/${version}`;
  }

  async configureMetaIntegration(
    companyId: string,
    dto: ConfigureMetaWhatsappDto,
  ): Promise<{
    provider: 'META_CLOUD';
    state: 'open';
    dbStatus: 'CONNECTED';
    phoneNumberId: string;
    businessPhoneNumber: string | null;
    verifiedName: string | null;
    qualityRating: string | null;
  }> {
    const profile = await this.graphFetch<MetaPhoneNumberProfile>(
      `/${dto.phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating`,
      dto.accessToken,
      { method: 'GET' },
    );

    const businessPhoneNumber =
      dto.businessPhoneNumber ?? profile.display_phone_number ?? null;

    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        whatsappProvider: 'META_CLOUD',
        whatsappInstanceId: dto.phoneNumberId,
        whatsappStatus: 'CONNECTED',
        metaPhoneNumberId: dto.phoneNumberId,
        metaBusinessAccountId: dto.businessAccountId,
        metaBusinessPhoneNumber: businessPhoneNumber,
        metaAccessTokenEncrypted: this.crypto.encrypt(dto.accessToken),
        metaDefaultLanguage: dto.defaultLanguage ?? 'pt_BR',
      },
    });

    return {
      provider: 'META_CLOUD',
      state: 'open',
      dbStatus: 'CONNECTED',
      phoneNumberId: dto.phoneNumberId,
      businessPhoneNumber,
      verifiedName: profile.verified_name ?? null,
      qualityRating: profile.quality_rating ?? null,
    };
  }

  async getStatus(companyId: string): Promise<{
    provider: 'META_CLOUD';
    state: 'open' | 'close';
    dbStatus: 'CONNECTED' | 'DISCONNECTED' | 'PENDING';
    phoneNumberId: string | null;
    businessAccountId: string | null;
    businessPhoneNumber: string | null;
    defaultLanguage: string;
    webhookUrl: string;
    templatesRequired: true;
  }> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        whatsappStatus: true,
        metaPhoneNumberId: true,
        metaBusinessAccountId: true,
        metaBusinessPhoneNumber: true,
        metaDefaultLanguage: true,
        metaAccessTokenEncrypted: true,
      },
    });

    const configured = Boolean(
      company?.metaPhoneNumberId && company.metaAccessTokenEncrypted,
    );
    const connected = configured && company?.whatsappStatus === 'CONNECTED';

    return {
      provider: 'META_CLOUD',
      state: connected ? 'open' : 'close',
      dbStatus: connected
        ? 'CONNECTED'
        : (company?.whatsappStatus ?? 'DISCONNECTED'),
      phoneNumberId: company?.metaPhoneNumberId ?? null,
      businessAccountId: company?.metaBusinessAccountId ?? null,
      businessPhoneNumber: company?.metaBusinessPhoneNumber ?? null,
      defaultLanguage: company?.metaDefaultLanguage ?? 'pt_BR',
      webhookUrl: this.buildWebhookUrl('/webhooks/meta'),
      templatesRequired: true,
    };
  }

  async disconnect(companyId: string): Promise<void> {
    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        whatsappStatus: 'DISCONNECTED',
        whatsappInstanceId: null,
        metaPhoneNumberId: null,
        metaBusinessAccountId: null,
        metaBusinessPhoneNumber: null,
        metaAccessTokenEncrypted: null,
      },
    });
  }

  async sendTemplateMessage(
    input: SendTemplateMessageInput,
  ): Promise<{ messageId: string; status: string | null }> {
    const company = await this.prisma.company.findFirst({
      where: {
        id: input.companyId,
        whatsappProvider: 'META_CLOUD',
        whatsappStatus: 'CONNECTED',
      },
      select: {
        metaPhoneNumberId: true,
        metaAccessTokenEncrypted: true,
      },
    });

    if (!company?.metaPhoneNumberId || !company.metaAccessTokenEncrypted) {
      throw new Error('Meta Cloud API nao configurada para esta empresa.');
    }

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: input.phoneNumber,
      type: 'template',
      template: {
        name: input.templateName,
        language: {
          code: input.languageCode,
        },
        components:
          input.bodyParameters.length > 0
            ? [
                {
                  type: 'body',
                  parameters: input.bodyParameters.map((parameter) => ({
                    type: 'text',
                    text: parameter,
                  })),
                },
              ]
            : undefined,
      },
    };

    const response = await this.graphFetch<MetaMessageResponse>(
      `/${company.metaPhoneNumberId}/messages`,
      this.crypto.decrypt(company.metaAccessTokenEncrypted),
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );

    const message = response.messages[0];
    if (!message) {
      throw new Error('Meta Cloud API nao retornou ID da mensagem.');
    }

    return {
      messageId: message.id,
      status: message.message_status ?? null,
    };
  }

  async sendTextMessage(
    input: SendTextMessageInput,
  ): Promise<{ messageId: string; status: string | null }> {
    const company = await this.prisma.company.findFirst({
      where: {
        id: input.companyId,
        whatsappProvider: 'META_CLOUD',
        whatsappStatus: 'CONNECTED',
      },
      select: {
        metaPhoneNumberId: true,
        metaAccessTokenEncrypted: true,
      },
    });

    if (!company?.metaPhoneNumberId || !company.metaAccessTokenEncrypted) {
      throw new Error('Meta Cloud API nao configurada para esta empresa.');
    }

    const response = await this.graphFetch<MetaMessageResponse>(
      `/${company.metaPhoneNumberId}/messages`,
      this.crypto.decrypt(company.metaAccessTokenEncrypted),
      {
        method: 'POST',
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: input.phoneNumber,
          type: 'text',
          text: {
            preview_url: false,
            body: input.text,
          },
        }),
      },
    );

    const message = response.messages[0];
    if (!message) {
      throw new Error('Meta Cloud API nao retornou ID da mensagem.');
    }

    return {
      messageId: message.id,
      status: message.message_status ?? null,
    };
  }

  async createOfficialTemplate(
    input: CreateOfficialTemplateInput,
  ): Promise<MetaTemplateResponse> {
    const company = await this.prisma.company.findFirst({
      where: {
        id: input.companyId,
        whatsappProvider: 'META_CLOUD',
        whatsappStatus: 'CONNECTED',
      },
      select: {
        metaBusinessAccountId: true,
        metaAccessTokenEncrypted: true,
      },
    });

    if (!company?.metaBusinessAccountId || !company.metaAccessTokenEncrypted) {
      throw new HttpException(
        'Configure a Meta Cloud API antes de enviar templates oficiais.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const officialTemplate = this.buildOfficialTemplatePayload(input.template);
    const response = await this.graphFetch<MetaTemplateResponse>(
      `/${company.metaBusinessAccountId}/message_templates`,
      this.crypto.decrypt(company.metaAccessTokenEncrypted),
      {
        method: 'POST',
        body: JSON.stringify({
          name: officialTemplate.name,
          language: officialTemplate.language,
          category: officialTemplate.category,
          components: [
            {
              type: 'BODY',
              text: officialTemplate.text,
              ...(officialTemplate.examples.length > 0
                ? { example: { body_text: [officialTemplate.examples] } }
                : {}),
            },
          ],
        }),
      },
    );

    await this.prisma.messageTemplate.updateMany({
      where: { id: input.template.id, companyId: input.companyId },
      data: {
        metaTemplateName: officialTemplate.name,
        metaLanguage: officialTemplate.language,
        metaStatus: response.status,
        metaRejectedReason: null,
        lastMetaSyncAt: new Date(),
      },
    });

    return response;
  }

  buildTemplateParameters(
    templateContent: string,
    replacements: Record<string, string>,
  ): string[] {
    const variableNames = this.extractTemplateVariableNames(templateContent);

    return variableNames.map(
      (variableName) => replacements[variableName] ?? '',
    );
  }

  buildMetaTemplateName(slug: string): string {
    return `cobrapix_${slug}`
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private buildOfficialTemplatePayload(
    template: CreateOfficialTemplateInput['template'],
  ): OfficialTemplatePayload {
    const variableNames = this.extractTemplateVariableNames(template.content);
    let index = 0;
    const text = this.normalizeOfficialTemplateText(template.content).replace(
      /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g,
      () => {
        index++;
        return `{{${index}}}`;
      },
    );

    return {
      name:
        template.metaTemplateName ?? this.buildMetaTemplateName(template.slug),
      language: template.metaLanguage,
      category: template.category,
      text,
      examples: variableNames.map(
        (variableName) => TEMPLATE_EXAMPLES[variableName] ?? 'exemplo',
      ),
    };
  }

  private normalizeOfficialTemplateText(content: string): string {
    return content.replace(
      /\{([^{}|]+(?:\|[^{}|]+)+)\}/g,
      (_match: string, options: string) => {
        const firstOption = options.split('|')[0]?.trim();
        return firstOption ?? '';
      },
    );
  }

  private extractTemplateVariableNames(templateContent: string): string[] {
    return Array.from(
      templateContent.matchAll(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g),
    )
      .map((match) => match[1])
      .filter((variableName): variableName is string => Boolean(variableName));
  }

  private async graphFetch<T>(
    path: string,
    accessToken: string,
    options: RequestInit,
  ): Promise<T> {
    const response = await fetch(`${this.graphBaseUrl}${path}`, {
      ...options,
      signal: options.signal ?? AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    const body = await response.text();
    const payload = body ? (JSON.parse(body) as unknown) : null;

    if (!response.ok) {
      const message = this.extractGraphErrorMessage(payload);
      throw new Error(
        `Meta Cloud API: falha (${response.status})${message ? `: ${message}` : ''}`,
      );
    }

    return payload as T;
  }

  private extractGraphErrorMessage(payload: unknown): string | null {
    if (!this.isRecord(payload) || !this.isRecord(payload.error)) {
      return null;
    }

    const message = payload.error.message;
    return typeof message === 'string' ? message : null;
  }

  private buildWebhookUrl(path: string): string {
    const baseUrl =
      this.configService.get<string>('META_WEBHOOK_BASE_URL') ??
      this.configService.get<string>('EFI_WEBHOOK_BASE_URL') ??
      'http://localhost:3001';

    return `${baseUrl.replace(/\/$/, '')}${path}`;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
