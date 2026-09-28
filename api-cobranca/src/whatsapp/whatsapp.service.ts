import { assertChannelAvailable } from '../communications/channel-availability';
import { assertRecipientNotSuppressed } from '../communications/recipient-suppression';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboundDispatcherService } from './outbound-dispatcher.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { templateVariableNames } from '../templates/template-provider-state';
import { WHATSAPP_TRANSPORT } from './transport/whatsapp-transport';
import type {
  ChannelInfo,
  WhatsappTransport,
  WhatsappTransportKind,
} from './transport/whatsapp-transport';

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

  private extractTemplateVariableNames(templateContent: string): string[] {
    return templateVariableNames(templateContent);
  }
}
