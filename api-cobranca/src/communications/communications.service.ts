import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CommunicationChannel,
  ConversationStatus,
  Prisma,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { ResendMailerService } from '../common/resend-mailer.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  templateBody,
  templateVariableNames,
} from '../templates/template-provider-state';
import { adminReplyKey, WhatsappService } from '../whatsapp/whatsapp.service';
import { assertChannelAvailable } from './channel-availability';
import { CommunicationAttributionService } from './communication-attribution.service';
import {
  CommunicationTokenService,
  CursorScope,
} from './communication-token.service';
import { olderThan } from './communications-tenant.service';
import { AttributeMessageDto } from './dto/attribute-message.dto';
import { ReplyConversationDto } from './dto/reply-conversation.dto';
import { TemplateReplyDto } from './dto/template-reply.dto';

/** Inbound message no company was attributed to, including legacy rows without method. */
const UNCLASSIFIED_INBOUND: Prisma.CommunicationMessageWhereInput = {
  direction: 'INBOUND',
  companyId: null,
  OR: [{ attributionMethod: 'UNASSIGNED' }, { attributionMethod: null }],
};

export interface CommunicationsPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

interface PageQuery {
  page: number;
  pageSize: number;
  channel?: CommunicationChannel;
}

interface AdminListQuery extends PageQuery {
  companyId?: string;
  invoiceId?: string;
  status?: ConversationStatus;
  pendingClassification?: boolean;
}

@Injectable()
export class CommunicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PaymentCryptoService,
    private readonly whatsapp: WhatsappService,
    private readonly resend: ResendMailerService,
    private readonly config: ConfigService,
    private readonly attribution: CommunicationAttributionService,
    private readonly tokens: CommunicationTokenService,
  ) {}

  async listOutbound(
    companyId: string,
    query: PageQuery,
  ): Promise<CommunicationsPage<unknown>> {
    const where = {
      companyId,
      direction: 'OUTBOUND' as const,
      ...(query.channel ? { conversation: { channel: query.channel } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.communicationMessage.findMany({
        where,
        select: {
          id: true,
          conversationId: true,
          invoiceId: true,
          debtorId: true,
          content: true,
          externalMessageId: true,
          status: true,
          createdAt: true,
          conversation: { select: { channel: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.communicationMessage.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async listAdminConversations(
    query: AdminListQuery,
  ): Promise<CommunicationsPage<unknown>> {
    const messageFilters: Prisma.CommunicationMessageWhereInput[] = [];
    if (query.companyId) messageFilters.push({ companyId: query.companyId });
    if (query.invoiceId) messageFilters.push({ invoiceId: query.invoiceId });
    if (query.pendingClassification) messageFilters.push(UNCLASSIFIED_INBOUND);
    const where: Prisma.CommunicationConversationWhereInput = {
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(messageFilters.length
        ? {
            AND: messageFilters.map((filter) => ({
              messages: { some: filter },
            })),
          }
        : {}),
    };
    const [records, total] = await Promise.all([
      this.prisma.communicationConversation.findMany({
        where,
        select: {
          id: true,
          channel: true,
          recipientEncrypted: true,
          status: true,
          unreadCount: true,
          lastMessagePreview: true,
          lastInboundAt: true,
          serviceWindowExpiresAt: true,
          updatedAt: true,
          _count: { select: { messages: { where: UNCLASSIFIED_INBOUND } } },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.communicationConversation.count({ where }),
    ]);
    const items = records.map(({ recipientEncrypted, _count, ...record }) => ({
      ...record,
      unclassifiedCount: _count.messages,
      recipient: recipientEncrypted
        ? this.decryptRecipient(recipientEncrypted)
        : null,
    }));
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /** Newest page first in storage order, returned oldest-first; `nextCursor` loads older messages. */
  async getAdminConversation(
    id: string,
    adminUserId: string,
    query: { cursor?: string; limit?: number } = {},
  ): Promise<unknown> {
    const conversation = await this.prisma.communicationConversation.findUnique(
      {
        where: { id },
        select: {
          id: true,
          channel: true,
          recipientEncrypted: true,
          status: true,
          unreadCount: true,
          lastInboundAt: true,
          serviceWindowExpiresAt: true,
          updatedAt: true,
        },
      },
    );
    if (!conversation) throw new NotFoundException('Conversa não encontrada.');
    const limit = query.limit ?? 50;
    const scope: CursorScope = {
      route: 'admin-conversation-messages',
      userId: adminUserId,
      companyId: null,
      conversationId: id,
    };
    const before = query.cursor
      ? this.tokens.decodeCursor(query.cursor, scope)
      : null;
    const rows = await this.prisma.communicationMessage.findMany({
      where: { conversationId: id, ...(before ? olderThan(before) : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        companyId: true,
        invoiceId: true,
        debtorId: true,
        direction: true,
        content: true,
        externalMessageId: true,
        replyToExternalMessageId: true,
        status: true,
        readAt: true,
        createdAt: true,
        messageType: true,
        source: true,
        attributionMethod: true,
        attributionRevision: true,
        company: { select: { id: true, corporateName: true, tradeName: true } },
        invoice: {
          select: {
            id: true,
            dueDate: true,
            originalAmount: true,
            status: true,
          },
        },
        debtor: { select: { id: true, name: true } },
        outboundIntent: { select: { state: true, lastErrorCode: true } },
        attachments: {
          select: {
            id: true,
            contentType: true,
            sizeBytes: true,
            state: true,
            errorCode: true,
          },
        },
      },
    });
    const page = rows.slice(0, limit);
    const references = [
      ...new Set(
        page
          .map((message) => message.replyToExternalMessageId)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const cited = references.length
      ? await this.prisma.communicationMessage.findMany({
          where: { conversationId: id, externalMessageId: { in: references } },
          select: { id: true, externalMessageId: true },
        })
      : [];
    const citedIds = new Map(
      cited.map((message) => [message.externalMessageId, message.id]),
    );
    const tail = page.at(-1);
    const { recipientEncrypted, ...safe } = conversation;
    return {
      ...safe,
      recipient: recipientEncrypted
        ? this.decryptRecipient(recipientEncrypted)
        : null,
      messages: page
        .map((message) => ({
          ...message,
          replyToMessageId: message.replyToExternalMessageId
            ? (citedIds.get(message.replyToExternalMessageId) ?? null)
            : null,
        }))
        .reverse(),
      nextCursor:
        rows.length > limit && tail
          ? this.tokens.encodeCursor(scope, { at: tail.createdAt, id: tail.id })
          : null,
    };
  }

  /**
   * Admin-only suggestions for attribution and reply context: debtors of any company whose
   * phone equals this contact, with recent invoices, plus companies already present in the
   * conversation. A suggestion grants nothing; every choice is revalidated on write.
   */
  async listContextOptions(conversationId: string): Promise<{
    options: Array<{
      company: { id: string; name: string };
      debtor: { id: string; name: string } | null;
      invoices: Array<{
        id: string;
        dueDate: Date;
        originalAmount: Prisma.Decimal;
        status: string;
      }>;
    }>;
  }> {
    const conversation = await this.prisma.communicationConversation.findUnique(
      {
        where: { id: conversationId },
        select: {
          channel: true,
          recipientEncrypted: true,
          recipientType: true,
        },
      },
    );
    if (!conversation) throw new NotFoundException('Conversa não encontrada.');
    const recipient =
      conversation.channel === 'WHATSAPP' &&
      conversation.recipientType !== 'BSUID' &&
      conversation.recipientEncrypted
        ? this.decryptRecipient(conversation.recipientEncrypted)
        : null;
    const digits = recipient?.replace(/\D/g, '') ?? null;
    const debtors = digits
      ? await this.prisma.$queryRaw<
          Array<{ id: string; companyId: string; name: string }>
        >(Prisma.sql`
          SELECT "id", "companyId", "name" FROM "Debtor"
          WHERE regexp_replace("phoneNumber", '\\D', '', 'g') = ${digits}
          ORDER BY "name" LIMIT 50`)
      : [];
    const [invoices, present] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { debtorId: { in: debtors.map((debtor) => debtor.id) } },
        select: {
          id: true,
          debtorId: true,
          dueDate: true,
          originalAmount: true,
          status: true,
        },
        orderBy: { dueDate: 'desc' },
        take: 200,
      }),
      this.prisma.communicationMessage.findMany({
        where: { conversationId, companyId: { not: null } },
        distinct: ['companyId'],
        select: { companyId: true },
      }),
    ]);
    const companyIds = [
      ...new Set([
        ...debtors.map((debtor) => debtor.companyId),
        ...present.map((message) => message.companyId as string),
      ]),
    ];
    const companies = new Map(
      (
        await this.prisma.company.findMany({
          where: { id: { in: companyIds } },
          select: { id: true, corporateName: true, tradeName: true },
        })
      ).map((company) => [
        company.id,
        { id: company.id, name: company.tradeName ?? company.corporateName },
      ]),
    );
    const options: Awaited<
      ReturnType<CommunicationsService['listContextOptions']>
    >['options'] = debtors
      .filter((debtor) => companies.has(debtor.companyId))
      .map((debtor) => ({
        company: companies.get(debtor.companyId)!,
        debtor: { id: debtor.id, name: debtor.name },
        invoices: invoices
          .filter((invoice) => invoice.debtorId === debtor.id)
          .slice(0, 10)
          .map((invoice) => ({
            id: invoice.id,
            dueDate: invoice.dueDate,
            originalAmount: invoice.originalAmount,
            status: invoice.status,
          })),
      }));
    for (const id of companyIds)
      if (!options.some((option) => option.company.id === id))
        options.push({
          company: companies.get(id)!,
          debtor: null,
          invoices: [],
        });
    return { options };
  }

  /** Manual correction with revision control; replies citing the message follow it. */
  async attributeMessage(
    messageId: string,
    adminUserId: string,
    dto: AttributeMessageDto,
  ): Promise<{ messageId: string; revision: number; context: unknown }> {
    const message = await this.prisma.communicationMessage.findUnique({
      where: { id: messageId },
      select: { companyId: true },
    });
    if (!message) throw new NotFoundException('Mensagem não encontrada.');
    return this.attribution.assignKnownContext({
      messageId,
      expectedRevision: dto.expectedRevision,
      expectedCompanyId: message.companyId,
      context: dto.context,
      method: 'MANUAL',
      actor: { type: 'PLATFORM_ADMIN', userId: adminUserId },
      reason: dto.reason,
    });
  }

  /** Approved global template, for replies outside the service window. */
  async replyWithTemplate(
    conversationId: string,
    dto: TemplateReplyDto,
  ): Promise<{ id: string; status: string; externalMessageId: string | null }> {
    const conversation = await this.prisma.communicationConversation.findUnique(
      {
        where: { id: conversationId },
        select: { channel: true, recipientEncrypted: true },
      },
    );
    if (!conversation) throw new NotFoundException('Conversa não encontrada.');
    if (conversation.channel !== 'WHATSAPP')
      throw new BadRequestException('Templates existem apenas no WhatsApp.');
    const template = await this.prisma.globalMessageTemplate.findUnique({
      where: { id: dto.templateId },
    });
    if (
      !template?.isActive ||
      template.metaStatus !== 'APPROVED' ||
      template.metaReviewRequired ||
      !template.metaTemplateName
    )
      throw new HttpException(
        {
          code: 'TEMPLATE_UNAVAILABLE',
          message: 'Template não aprovado ou em revisão.',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    const body = templateBody(template.content);
    const positions = templateVariableNames(template.content).length;
    if (dto.parameters.length !== positions)
      throw new BadRequestException(
        `O template exige ${positions} parâmetro(s).`,
      );
    if (template.paymentButtonEnabled && !dto.context?.invoiceId)
      throw new BadRequestException(
        'Template com botão de pagamento exige a cobrança de contexto.',
      );
    const recipient = conversation.recipientEncrypted
      ? this.decryptRecipient(conversation.recipientEncrypted)
      : null;
    if (!recipient)
      throw new HttpException(
        'Destinatário indisponível.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    await assertChannelAvailable(this.prisma, 'META');
    const content = body.replace(
      /\{\{(\d+)\}\}/g,
      (_match: string, position: string) =>
        dto.parameters[Number(position) - 1] ?? '',
    );
    const queued = await this.whatsapp.enqueueAdminTemplate(
      recipient,
      {
        name: template.metaTemplateName,
        language: template.metaLanguage,
        content,
        parameters: dto.parameters,
        paymentButton: template.paymentButtonEnabled,
      },
      dto.idempotencyId,
      dto.context ? { context: dto.context } : {},
    );
    await this.prisma.communicationConversation.update({
      where: { id: conversationId },
      data: {
        status: 'IN_PROGRESS',
        lastMessagePreview: content.slice(0, 255),
        unreadCount: 0,
      },
    });
    return queued;
  }

  async updateAdminStatus(
    id: string,
    status: ConversationStatus,
  ): Promise<unknown> {
    const existing = await this.prisma.communicationConversation.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Conversa não encontrada.');
    return this.prisma.communicationConversation.update({
      where: { id },
      data: { status },
      select: { id: true, status: true },
    });
  }

  async replyToAdminConversation(
    conversationId: string,
    dto: ReplyConversationDto,
  ): Promise<{ id: string; status: string; externalMessageId: string | null }> {
    const conversation = await this.prisma.communicationConversation.findUnique(
      {
        where: { id: conversationId },
        select: {
          id: true,
          channel: true,
          recipientEncrypted: true,
          serviceWindowExpiresAt: true,
        },
      },
    );
    if (!conversation) throw new NotFoundException('Conversa não encontrada.');

    const existing = await this.prisma.communicationMessage.findUnique({
      where: { id: dto.idempotencyId },
      select: {
        id: true,
        conversationId: true,
        status: true,
        content: true,
        externalMessageId: true,
      },
    });
    if (existing) {
      if (
        existing.conversationId !== conversationId ||
        existing.content !== dto.content.trim()
      ) {
        throw new ConflictException('Identificador de resposta já utilizado.');
      }
      if (existing.status === 'sent' && existing.externalMessageId)
        return {
          id: existing.id,
          status: 'sent',
          externalMessageId: existing.externalMessageId,
        };
      throw new ConflictException({
        code: 'REPLY_DELIVERY_AMBIGUOUS',
        message:
          'Esta resposta já foi processada e não será reenviada automaticamente.',
      });
    }

    // A retry of an already reserved reply returns its existing result (or 409 if the
    // content/context changed) even after the window closed; only new replies need the window.
    const reserved =
      conversation.channel === 'WHATSAPP' &&
      (await this.prisma.communicationOutboundIntent.findUnique({
        where: { idempotencyKey: adminReplyKey(dto.idempotencyId) },
        select: { id: true },
      }));
    if (
      conversation.channel === 'WHATSAPP' &&
      !reserved &&
      (!conversation.serviceWindowExpiresAt ||
        conversation.serviceWindowExpiresAt <= new Date())
    ) {
      throw new HttpException(
        {
          code: 'WHATSAPP_SERVICE_WINDOW_CLOSED',
          message: 'A janela de atendimento do WhatsApp está fechada.',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const recipient = conversation.recipientEncrypted
      ? this.decryptRecipient(conversation.recipientEncrypted)
      : null;
    if (!recipient)
      throw new HttpException(
        'Destinatário indisponível.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );

    const content = dto.content.trim();
    if (!content)
      throw new HttpException('Informe a resposta.', HttpStatus.BAD_REQUEST);
    if (
      conversation.channel !== 'WHATSAPP' &&
      (dto.context || dto.replyToMessageId)
    )
      throw new BadRequestException(
        'Contexto e citação estão disponíveis apenas no WhatsApp.',
      );
    await assertChannelAvailable(
      this.prisma,
      conversation.channel === 'WHATSAPP' ? 'META' : 'RESEND',
    );
    if (conversation.channel === 'WHATSAPP') {
      const quoted = dto.replyToMessageId
        ? await this.prisma.communicationMessage.findFirst({
            where: {
              id: dto.replyToMessageId,
              conversationId,
              externalMessageId: { not: null },
              transportChannelId: this.config.get<string>(
                'META_PHONE_NUMBER_ID',
              ),
            },
            select: { externalMessageId: true },
          })
        : null;
      if (dto.replyToMessageId && !quoted?.externalMessageId)
        throw new BadRequestException(
          'A mensagem citada não pertence a esta conversa e canal.',
        );
      // Context is validated against this recipient before the intent is persisted.
      const queued = await this.whatsapp.enqueueAdminReply(
        recipient,
        content,
        dto.idempotencyId,
        {
          ...(dto.context ? { context: dto.context } : {}),
          ...(quoted?.externalMessageId
            ? { replyToExternalMessageId: quoted.externalMessageId }
            : {}),
        },
      );
      await this.prisma.communicationConversation.update({
        where: { id: conversationId },
        data: {
          status: 'IN_PROGRESS',
          lastMessagePreview: content.slice(0, 255),
          unreadCount: 0,
        },
      });
      return queued;
    }
    const retentionExpiresAt = new Date();
    retentionExpiresAt.setUTCFullYear(retentionExpiresAt.getUTCFullYear() + 5);
    await this.prisma.communicationMessage.create({
      data: {
        id: dto.idempotencyId,
        conversationId,
        companyId: null,
        invoiceId: null,
        debtorId: null,
        direction: 'OUTBOUND',
        content,
        status: 'sending',
        retentionExpiresAt,
      },
    });

    try {
      const externalMessageId = await this.deliverCentralEmail(
        recipient,
        content,
        dto.idempotencyId,
      );
      await this.prisma.communicationMessage.update({
        where: { id: dto.idempotencyId },
        data: { status: 'sent', externalMessageId },
      });
      await this.prisma.communicationConversation.update({
        where: { id: conversationId },
        data: {
          status: 'IN_PROGRESS',
          lastMessagePreview: content.slice(0, 255),
          unreadCount: 0,
          retentionExpiresAt,
        },
      });
      return { id: dto.idempotencyId, status: 'sent', externalMessageId };
    } catch (error) {
      await this.markFailedIfStillSending(dto.idempotencyId);
      throw error;
    }
  }

  private async deliverCentralEmail(
    recipient: string,
    content: string,
    idempotencyId: string,
  ): Promise<string> {
    await assertChannelAvailable(this.prisma, 'RESEND');
    const result = await this.resend.sendEmail({
      apiKey: this.requiredConfig('RESEND_API_KEY'),
      from: this.requiredConfig('RESEND_FROM_EMAIL'),
      replyTo: this.requiredConfig('RESEND_REPLY_TO'),
      to: [recipient],
      subject: 'Resposta do atendimento CifraMais',
      html: `<p>${this.escapeHtml(content).replace(/\n/g, '<br>')}</p>`,
      idempotencyKey: `central-reply:${idempotencyId}`,
    });
    return result.id;
  }

  private async markFailedIfStillSending(id: string): Promise<void> {
    try {
      await this.prisma.communicationMessage.updateMany({
        where: { id, status: 'sending', externalMessageId: null },
        data: { status: 'delivery_uncertain' },
      });
    } catch {
      // Keep the original delivery error. A retry with the same id remains blocked.
    }
  }

  private requiredConfig(name: string): string {
    const value = this.config.get<string>(name)?.trim();
    if (!value) throw new Error('Canal central de e-mail indisponível.');
    return value;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private decryptRecipient(value: string): string | null {
    try {
      const recipient = this.crypto.decrypt(value);
      return typeof recipient === 'string' ? recipient : null;
    } catch {
      return null;
    }
  }
}
