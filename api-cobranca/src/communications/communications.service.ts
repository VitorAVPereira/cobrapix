import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CommunicationChannel, ConversationStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { ResendMailerService } from '../common/resend-mailer.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { assertChannelAvailable } from './channel-availability';
import { ReplyConversationDto } from './dto/reply-conversation.dto';

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

@Injectable()
export class CommunicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PaymentCryptoService,
    private readonly whatsapp: WhatsappService,
    private readonly resend: ResendMailerService,
    private readonly config: ConfigService,
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
    query: PageQuery,
  ): Promise<CommunicationsPage<unknown>> {
    const where = query.channel ? { channel: query.channel } : {};
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
        },
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.communicationConversation.count({ where }),
    ]);
    const items = records.map(({ recipientEncrypted, ...record }) => ({
      ...record,
      recipient: recipientEncrypted
        ? this.decryptRecipient(recipientEncrypted)
        : null,
    }));
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async getAdminConversation(id: string): Promise<unknown> {
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
          messages: {
            select: {
              id: true,
              companyId: true,
              invoiceId: true,
              debtorId: true,
              direction: true,
              content: true,
              externalMessageId: true,
              status: true,
              readAt: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    );
    if (!conversation) throw new NotFoundException('Conversa não encontrada.');
    const { recipientEncrypted, ...safe } = conversation;
    return {
      ...safe,
      recipient: recipientEncrypted
        ? this.decryptRecipient(recipientEncrypted)
        : null,
    };
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

    if (
      conversation.channel === 'WHATSAPP' &&
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
    await assertChannelAvailable(
      this.prisma,
      conversation.channel === 'WHATSAPP' ? 'META' : 'RESEND',
    );
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
      const externalMessageId = await this.deliverCentralReply(
        conversation.channel,
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

  private async deliverCentralReply(
    channel: CommunicationChannel,
    recipient: string,
    content: string,
    idempotencyId: string,
  ): Promise<string> {
    if (channel === 'WHATSAPP') {
      await assertChannelAvailable(this.prisma, 'META');
      const result = await this.whatsapp.sendTextMessage({
        companyId: null,
        phoneNumber: recipient,
        text: content,
        recordHistory: false,
      });
      return result.messageId;
    }
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
