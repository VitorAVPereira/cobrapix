import { assertChannelAvailable } from '../communications/channel-availability';
import { assertRecipientNotSuppressed } from '../communications/recipient-suppression';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboundDispatcherService } from './outbound-dispatcher.service';
import type {
  MessageTemplate,
  MessageTemplateCopyCodeSource,
  WhatsAppTemplateCategory,
} from '@prisma/client';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  templateCompatibility,
  templateVariableNames,
} from '../templates/template-provider-state';
import { WhatsappTransportError } from './transport/whatsapp-transport.error';
import { WHATSAPP_TRANSPORT } from './transport/whatsapp-transport';
import type {
  ChannelInfo,
  WhatsappTransport,
  WhatsappTransportKind,
} from './transport/whatsapp-transport';

interface MetaTemplateResponse {
  id: string;
  status: string;
  category?: string;
}

interface MetaTemplateListItem {
  id?: string;
  category?: string;
  components?: unknown[];
  quality_score?: string;
  name?: string;
  language?: string;
  status?: string;
  rejected_reason?: string;
}

export interface OfficialTemplateStatus {
  id?: string;
  category?: string;
  components?: unknown[];
  quality?: string;
  name: string;
  language: string;
  status: string;
  rejectedReason: string | null;
}

interface SendTemplateMessageInput {
  idempotencyKey: string;
  /**
   * Treat idempotencyKey as a series: after a definitive rejection (never transmitted)
   * the next call gets a new attempt key instead of the rejected intent.
   */
  attemptSeries?: boolean;
  ruleStepId?: string;
  companyId: string;
  phoneNumber: string;
  templateName: string;
  languageCode: string;
  bodyParameters: string[];
  buttonUrlSuffix?: string | null;
  invoiceId?: string;
  debtorId?: string;
  content?: string;
}

/** Idempotency key of a platform text reply; also used to recognize a retry. */
export function adminReplyKey(idempotencyId: string): string {
  return `admin-reply:${idempotencyId}`;
}

export interface AdminReplyOptions {
  context?: {
    companyId: string | null;
    invoiceId?: string | null;
    debtorId?: string | null;
  };
  replyToExternalMessageId?: string;
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

const TEMPLATE_EXAMPLES: Record<string, string> = {
  saudacao: 'Ola',
  instrucoes: 'Confira o pagamento no botao abaixo.',
  assinatura: 'Equipe financeira',
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
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly crypto: PaymentCryptoService,
    @Inject(WHATSAPP_TRANSPORT) private readonly transport: WhatsappTransport,
    private readonly dispatcher: OutboundDispatcherService,
  ) {}

  async testIntegration(): Promise<
    ChannelInfo & {
      transport: WhatsappTransportKind;
      authentication: 'AUTHENTICATED';
      checkedAt: string;
      webhookSupported: boolean;
    }
  > {
    const channel = await this.transport.getChannelInfo();
    return {
      ...channel,
      transport: this.transport.kind,
      authentication: 'AUTHENTICATED',
      checkedAt: new Date().toISOString(),
      webhookSupported: true,
    };
  }

  async sendTemplateMessage(
    input: SendTemplateMessageInput,
  ): Promise<{ messageId: string; status: string | null }> {
    await assertChannelAvailable(this.prisma, 'META');
    await assertRecipientNotSuppressed(this.prisma, input.phoneNumber);
    const { idempotencyKey, attemptSeries, ...payload } = input;
    return this.dispatcher.send(
      {
        ...payload,
        content: input.content ?? 'Template: ' + input.templateName,
        messageType: 'template',
      },
      attemptSeries
        ? await this.dispatcher.attemptKey(idempotencyKey)
        : idempotencyKey,
    );
  }

  /** Context is validated against the recipient before the intent is persisted. */
  enqueueAdminReply(
    phoneNumber: string,
    content: string,
    idempotencyId: string,
    options: AdminReplyOptions = {},
  ): Promise<{ id: string; status: string; externalMessageId: string | null }> {
    return this.dispatcher.enqueue(
      {
        ...this.adminContext(options),
        phoneNumber,
        content,
        messageType: 'text',
        origin: 'ADMIN_REPLY',
        ...(options.replyToExternalMessageId
          ? { replyToExternalMessageId: options.replyToExternalMessageId }
          : {}),
      },
      adminReplyKey(idempotencyId),
    );
  }

  enqueueAdminTemplate(
    phoneNumber: string,
    template: {
      name: string;
      language: string;
      content: string;
      parameters: string[];
      paymentButton: boolean;
    },
    idempotencyId: string,
    options: AdminReplyOptions = {},
  ): Promise<{ id: string; status: string; externalMessageId: string | null }> {
    return this.dispatcher.enqueue(
      {
        ...this.adminContext(options),
        phoneNumber,
        content: template.content,
        messageType: 'template',
        origin: 'ADMIN_REPLY',
        templateName: template.name,
        languageCode: template.language,
        bodyParameters: template.parameters,
        ...(template.paymentButton ? { paymentButtonFromInvoice: true } : {}),
      },
      'admin-template:' + idempotencyId,
    );
  }

  private adminContext(options: AdminReplyOptions): {
    companyId: string | null;
    invoiceId?: string;
    debtorId?: string;
  } {
    return {
      companyId: options.context?.companyId ?? null,
      ...(options.context?.invoiceId
        ? { invoiceId: options.context.invoiceId }
        : {}),
      ...(options.context?.debtorId
        ? { debtorId: options.context.debtorId }
        : {}),
    };
  }

  dispatchIntent(
    id: string,
  ): Promise<{ messageId: string; status: string | null }> {
    return this.dispatcher.dispatch(id);
  }

  rejectedCollection(id: string): Promise<{
    companyId: string;
    invoiceId: string;
    ruleStepId?: string;
  } | null> {
    return this.dispatcher.rejectedCollection(id);
  }

  async createOfficialTemplate(
    input: CreateOfficialTemplateInput,
  ): Promise<MetaTemplateResponse> {
    const officialTemplate = this.buildOfficialTemplatePayload(input.template);
    const official = await this.listOfficialTemplateStatuses(input.companyId);
    const existing = official.find(
      (item) =>
        item.name === officialTemplate.name &&
        item.language === officialTemplate.language,
    );
    if (existing) {
      const compatible =
        existing.category === officialTemplate.category &&
        templateCompatibility(
          {
            ...input.template,
            footerText: input.template.footerText ?? null,
            paymentButtonEnabled: input.template.paymentButtonEnabled ?? false,
            paymentButtonLabel:
              input.template.paymentButtonLabel ?? 'Abrir pagamento',
            copyCodeButtonEnabled:
              input.template.copyCodeButtonEnabled ?? false,
          },
          existing.components,
        );
      await this.prisma.globalMessageTemplate.updateMany({
        where: { id: input.template.id },
        data: {
          metaTemplateId: existing.id,
          metaStatus: existing.status,
          metaReviewRequired: !compatible,
          metaProviderCategory: existing.category,
          lastMetaSyncAt: new Date(),
        },
      });
      if (!compatible)
        throw new HttpException(
          'Template existente possui conteudo ou categoria diferente. Revise antes de enviar.',
          HttpStatus.CONFLICT,
        );
      return {
        id: existing.id ?? officialTemplate.name,
        status: existing.status,
        category: existing.category,
      };
    }
    const claim = await this.prisma.globalMessageTemplate.updateMany({
      where: {
        id: input.template.id,
        metaStatus: { in: ['LOCAL', 'REJECTED'] },
      },
      data: { metaStatus: 'SUBMITTING' },
    });
    if (!claim.count)
      throw new HttpException(
        'Template ja submetido ou exige conciliacao. Sincronize o catalogo.',
        HttpStatus.CONFLICT,
      );
    try {
      const response = await this.transport.createTemplate(officialTemplate);
      await this.prisma.globalMessageTemplate.updateMany({
        where: { id: input.template.id, metaStatus: 'SUBMITTING' },
        data: {
          metaTemplateId: response.id,
          metaTemplateName: officialTemplate.name,
          metaLanguage: officialTemplate.language,
          metaStatus: response.status,
          metaProviderCategory: response.category,
          metaRejectedReason: null,
          lastMetaSyncAt: new Date(),
        },
      });
      return response;
    } catch (error: unknown) {
      const safe =
        error instanceof WhatsappTransportError &&
        error.outcome !== 'UNCERTAIN';
      await this.prisma.globalMessageTemplate.updateMany({
        where: { id: input.template.id, metaStatus: 'SUBMITTING' },
        data: { metaStatus: safe ? 'LOCAL' : 'SUBMISSION_UNCERTAIN' },
      });
      throw error;
    }
  }

  async listOfficialTemplateStatuses(
    companyId: string,
  ): Promise<OfficialTemplateStatus[]> {
    void companyId;
    const results: OfficialTemplateStatus[] = [];
    const cursors = new Set<string>();
    let after: string | undefined;
    do {
      const response = await this.transport.listTemplates(after);
      for (const item of response.data) {
        const mapped = this.mapOfficialTemplateStatus(item);
        if (mapped) results.push(mapped);
      }
      after = response.after;
      if (after && (cursors.has(after) || cursors.size >= 100))
        throw new HttpException(
          'Paginacao de templates invalida.',
          HttpStatus.BAD_GATEWAY,
        );
      if (after) cursors.add(after);
    } while (after);
    return results;
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
    const name =
      template.metaTemplateName ?? this.buildMetaTemplateName(template.slug);
    if (
      !/^[a-z0-9_]{1,512}$/.test(name) ||
      !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(template.metaLanguage)
    )
      throw new HttpException(
        'Nome ou idioma do template invalido.',
        HttpStatus.BAD_REQUEST,
      );
    const variableNames = this.extractTemplateVariableNames(template.content);
    if (variableNames.some((variable) => !TEMPLATE_EXAMPLES[variable]))
      throw new HttpException(
        'Variavel sem exemplo cadastrado.',
        HttpStatus.BAD_REQUEST,
      );
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

  private mapOfficialTemplateStatus(
    template: MetaTemplateListItem,
  ): OfficialTemplateStatus | null {
    const name = this.readString(template.name);
    const language = this.readString(template.language);
    const status = this.readString(template.status);

    if (!name || !language || !status) {
      return null;
    }

    return {
      name,
      language,
      status,
      id: template.id,
      category: template.category,
      components: template.components,
      quality: template.quality_score,
      rejectedReason: this.normalizeRejectedReason(template.rejected_reason),
    };
  }

  private normalizeRejectedReason(reason: string | undefined): string | null {
    const normalizedReason = this.readString(reason);

    if (!normalizedReason || normalizedReason.toUpperCase() === 'NONE') {
      return null;
    }

    return normalizedReason;
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
    return templateVariableNames(templateContent);
  }

  private readString(value: string | undefined): string | null {
    return value && value.trim() ? value.trim() : null;
  }

  private getPaymentPageBaseUrl(): string {
    const frontendUrl = this.configService.get<string>(
      'FRONTEND_URL',
      'http://localhost:3000',
    );

    return `${frontendUrl.replace(/\/$/, '')}/pagar`;
  }
}
