import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  MessageTemplate,
  MessageTemplateCopyCodeSource,
  WhatsAppTemplateCategory,
} from '@prisma/client';
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
  buttonUrlSuffix?: string | null;
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
  > &
    Partial<
      Pick<
        MessageTemplate,
        | 'footerText'
        | 'paymentButtonEnabled'
        | 'paymentButtonLabel'
        | 'copyCodeButtonEnabled'
        | 'copyCodeSource'
      >
    >;
}

interface OfficialTemplatePayload {
  name: string;
  language: string;
  category: WhatsAppTemplateCategory;
  components: WhatsAppTemplateComponent[];
}

interface WhatsAppBodyComponent {
  type: 'BODY';
  text: string;
  example?: { body_text: string[][] };
}

interface WhatsAppFooterComponent {
  type: 'FOOTER';
  text: string;
}

interface WhatsAppButtonsComponent {
  type: 'BUTTONS';
  buttons: WhatsAppTemplateButton[];
}

type WhatsAppTemplateComponent =
  | WhatsAppBodyComponent
  | WhatsAppFooterComponent
  | WhatsAppButtonsComponent;

type WhatsAppTemplateButton = UrlTemplateButton | CopyCodeTemplateButton;

interface UrlTemplateButton {
  type: 'URL';
  text: string;
  url: string;
  example: string[];
}

interface CopyCodeTemplateButton {
  type: 'COPY_CODE';
  example: string;
}

interface MetaGraphErrorData {
  details?: string;
}

interface MetaGraphError {
  message?: string;
  error_user_title?: string;
  error_user_msg?: string;
  error_data?: MetaGraphErrorData;
  error_subcode?: number | string;
  fbtrace_id?: string;
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

const COPY_CODE_MAX_LENGTH = 15;
const PAYMENT_BUTTON_EXAMPLE_TOKEN = 'exemplo-token';

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

    const components = [
      ...(input.bodyParameters.length > 0
        ? [
            {
              type: 'body',
              parameters: input.bodyParameters.map((parameter) => ({
                type: 'text',
                text: parameter,
              })),
            },
          ]
        : []),
      ...(input.buttonUrlSuffix
        ? [
            {
              type: 'button',
              sub_type: 'url',
              index: '0',
              parameters: [
                {
                  type: 'text',
                  text: input.buttonUrlSuffix,
                },
              ],
            },
          ]
        : []),
    ];

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
        components: components.length > 0 ? components : undefined,
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
          components: officialTemplate.components,
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
    this.validateOfficialTemplateText(text);
    const examples = variableNames.map((variableName) =>
      this.getTemplateExample(variableName),
    );
    const bodyComponent: WhatsAppBodyComponent = {
      type: 'BODY',
      text,
      ...(examples.length > 0 ? { example: { body_text: [examples] } } : {}),
    };
    const footerComponent = this.buildFooterComponent(
      template.footerText ?? null,
    );
    const buttonsComponent = this.buildButtonsComponent(template);

    return {
      name:
        template.metaTemplateName ?? this.buildMetaTemplateName(template.slug),
      language: template.metaLanguage,
      category: template.category,
      components: [
        bodyComponent,
        ...(footerComponent ? [footerComponent] : []),
        ...(buttonsComponent ? [buttonsComponent] : []),
      ],
    };
  }

  private buildFooterComponent(
    footerText: string | null,
  ): WhatsAppFooterComponent | null {
    const text = this.replaceTemplateVariablesWithExamples(
      this.normalizeOfficialTemplateText(footerText ?? ''),
    ).trim();

    if (!text) {
      return null;
    }

    return {
      type: 'FOOTER',
      text,
    };
  }

  private buildButtonsComponent(
    template: CreateOfficialTemplateInput['template'],
  ): WhatsAppButtonsComponent | null {
    const buttons: WhatsAppTemplateButton[] = [];

    if (template.paymentButtonEnabled) {
      const paymentUrl = `${this.getPaymentPageBaseUrl()}/{{1}}`;
      buttons.push({
        type: 'URL',
        text: template.paymentButtonLabel || 'Abrir pagamento',
        url: paymentUrl,
        example: [
          `${this.getPaymentPageBaseUrl()}/${PAYMENT_BUTTON_EXAMPLE_TOKEN}`,
        ],
      });
    }

    if (template.copyCodeButtonEnabled) {
      buttons.push({
        type: 'COPY_CODE',
        example: this.getCopyCodeExample(template.copyCodeSource ?? 'AUTO'),
      });
    }

    return buttons.length > 0
      ? {
          type: 'BUTTONS',
          buttons,
        }
      : null;
  }

  private getCopyCodeExample(source: MessageTemplateCopyCodeSource): string {
    const exampleBySource: Record<MessageTemplateCopyCodeSource, string> = {
      AUTO: this.getTemplateExample('pix_copia_e_cola'),
      PIX_COPY_PASTE: this.getTemplateExample('pix_copia_e_cola'),
      BOLETO_LINE_DIGITABLE: this.getTemplateExample('boleto_linha_digitavel'),
    };
    const example = exampleBySource[source];

    if (example.length <= COPY_CODE_MAX_LENGTH) {
      return example;
    }

    throw new HttpException(
      'O botao COPY_CODE da Meta aceita no maximo 15 caracteres. Use o botao de pagamento para Pix copia e cola ou linha digitavel longos.',
      HttpStatus.BAD_REQUEST,
    );
  }

  private replaceTemplateVariablesWithExamples(content: string): string {
    return content.replace(
      /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g,
      (_match: string, variableName: string) =>
        this.getTemplateExample(variableName),
    );
  }

  private getTemplateExample(variableName: string): string {
    return TEMPLATE_EXAMPLES[variableName] ?? 'exemplo';
  }

  private validateOfficialTemplateText(text: string): void {
    const trimmedText = text.trim();
    const startsWithVariable = /^\{\{\d+\}\}/.test(trimmedText);
    const endsWithVariable = /\{\{\d+\}\}$/.test(trimmedText);
    const hasFloatingVariableLine = text
      .split(/\r?\n/)
      .some((line) => /^\s*\{\{\d+\}\}\s*$/.test(line));

    if (!startsWithVariable && !endsWithVariable && !hasFloatingVariableLine) {
      return;
    }

    throw new HttpException(
      'A mensagem oficial da Meta nao pode comecar, terminar ou ter uma linha composta apenas por variavel. Adicione texto fixo antes e depois de cada {{variavel}}.',
      HttpStatus.BAD_REQUEST,
    );
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
    const payload = this.parseGraphResponseBody(body);

    if (!response.ok) {
      const message = this.formatGraphError(payload);
      throw new HttpException(
        `Meta Cloud API: falha (${response.status})${message ? `: ${message}` : ''}`,
        this.mapGraphErrorStatus(response.status),
      );
    }

    return payload as T;
  }

  private parseGraphResponseBody(body: string): unknown {
    if (!body) {
      return null;
    }

    try {
      return JSON.parse(body) as unknown;
    } catch {
      return body;
    }
  }

  private formatGraphError(payload: unknown): string | null {
    if (!this.isRecord(payload) || !this.isRecord(payload.error)) {
      return null;
    }

    const error = payload.error as MetaGraphError;
    const parts = [
      this.readString(error.message),
      this.readString(error.error_user_title),
      this.readString(error.error_user_msg),
      this.readString(error.error_data?.details),
      this.formatGraphSubcode(error.error_subcode),
      this.formatGraphTrace(error.fbtrace_id),
    ].filter((part): part is string => part !== null);
    const uniqueParts = parts.filter(
      (part, index) => parts.indexOf(part) === index,
    );

    return uniqueParts.length > 0 ? uniqueParts.join(' | ') : null;
  }

  private mapGraphErrorStatus(status: number): HttpStatus {
    if (status >= 400 && status < 500) {
      return HttpStatus.BAD_REQUEST;
    }

    return HttpStatus.BAD_GATEWAY;
  }

  private formatGraphSubcode(
    subcode: number | string | undefined,
  ): string | null {
    if (subcode === undefined) {
      return null;
    }

    return `subcode ${subcode}`;
  }

  private formatGraphTrace(traceId: string | undefined): string | null {
    return traceId ? `fbtrace_id ${traceId}` : null;
  }

  private readString(value: string | undefined): string | null {
    return value && value.trim() ? value.trim() : null;
  }

  private buildWebhookUrl(path: string): string {
    const baseUrl =
      this.configService.get<string>('META_WEBHOOK_BASE_URL') ??
      this.configService.get<string>('EFI_WEBHOOK_BASE_URL') ??
      'http://localhost:3001';

    return `${baseUrl.replace(/\/$/, '')}${path}`;
  }

  private getPaymentPageBaseUrl(): string {
    const frontendUrl = this.configService.get<string>(
      'FRONTEND_URL',
      'http://localhost:3000',
    );

    return `${frontendUrl.replace(/\/$/, '')}/pagar`;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
