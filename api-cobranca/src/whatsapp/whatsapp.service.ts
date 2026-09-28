import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboundDispatcherService } from './outbound-dispatcher.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { WHATSAPP_TRANSPORT } from './transport/whatsapp-transport';
import type {
  ChannelInfo,
  WhatsappTransport,
  WhatsappTransportKind,
} from './transport/whatsapp-transport';

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

  /** Queues a template reply already prepared under the company template policy. */
  enqueuePreparedTemplate(
    intentId: string,
  ): Promise<{ id: string; status: string; externalMessageId: string | null }> {
    return this.dispatcher.enqueuePrepared(intentId);
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
}
