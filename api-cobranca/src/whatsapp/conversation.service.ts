import { Injectable, Logger } from '@nestjs/common';
import { ConversationStatus, Prisma } from '@prisma/client';
import { getWhatsAppNumberLookupCandidates } from '../common/whatsapp-number';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from './whatsapp.service';

interface InboundMessageInput {
  companyId: string;
  phoneNumber: string;
  messageId?: string;
  content: string;
  timestamp?: string;
}

@Injectable()
export class WhatsAppConversationService {
  private readonly logger = new Logger(WhatsAppConversationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsappService: WhatsappService,
  ) {}

  async listConversations(
    companyId: string,
    params: {
      status?: ConversationStatus;
      search?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = params.page ?? 1;
    const pageSize = Math.min(params.pageSize ?? 20, 50);

    const where: Prisma.WhatsAppConversationWhereInput = { companyId };

    if (params.status) {
      where.status = params.status;
    }

    if (params.search) {
      where.OR = [
        { phoneNumber: { contains: params.search } },
        {
          debtor: {
            name: { contains: params.search, mode: 'insensitive' },
          },
        },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.whatsAppConversation.findMany({
        where,
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          assignee: { select: { id: true, name: true } },
          debtor: { select: { id: true, name: true } },
          _count: { select: { messages: true } },
        },
      }),
      this.prisma.whatsAppConversation.count({ where }),
    ]);

    return {
      data: data.map((conv) => ({
        id: conv.id,
        phoneNumber: conv.phoneNumber,
        status: conv.status,
        debtorName: conv.debtor?.name ?? null,
        debtorId: conv.debtorId,
        assignee: conv.assignee
          ? { id: conv.assignee.id, name: conv.assignee.name }
          : null,
        lastMessagePreview: conv.lastMessagePreview,
        unreadCount: conv.unreadCount,
        serviceWindowExpiresAt: conv.serviceWindowExpiresAt?.toISOString() ?? null,
        lastInboundAt: conv.lastInboundAt?.toISOString() ?? null,
        messageCount: conv._count.messages,
        updatedAt: conv.updatedAt.toISOString(),
        createdAt: conv.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  async getConversation(companyId: string, conversationId: string) {
    const conv = await this.prisma.whatsAppConversation.findFirst({
      where: { id: conversationId, companyId },
      include: {
        assignee: { select: { id: true, name: true } },
        debtor: { select: { id: true, name: true } },
      },
    });

    if (!conv) return null;

    return {
      id: conv.id,
      phoneNumber: conv.phoneNumber,
      status: conv.status,
      debtorName: conv.debtor?.name ?? null,
      debtorId: conv.debtorId,
      assignee: conv.assignee
        ? { id: conv.assignee.id, name: conv.assignee.name }
        : null,
      lastMessagePreview: conv.lastMessagePreview,
      unreadCount: conv.unreadCount,
      serviceWindowExpiresAt: conv.serviceWindowExpiresAt?.toISOString() ?? null,
      lastInboundAt: conv.lastInboundAt?.toISOString() ?? null,
      updatedAt: conv.updatedAt.toISOString(),
      createdAt: conv.createdAt.toISOString(),
    };
  }

  async getMessages(companyId: string, conversationId: string) {
    const conv = await this.prisma.whatsAppConversation.findFirst({
      where: { id: conversationId, companyId },
      select: { id: true },
    });

    if (!conv) return [];

    const messages = await this.prisma.whatsAppMessage.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        direction: true,
        content: true,
        messageId: true,
        status: true,
        readAt: true,
        createdAt: true,
      },
      take: 200,
    });

    await Promise.all([
      this.prisma.whatsAppConversation.updateMany({
        where: { id: conv.id, companyId },
        data: { unreadCount: 0 },
      }),
      this.prisma.whatsAppMessage.updateMany({
        where: {
          conversationId: conv.id,
          direction: 'INBOUND',
          readAt: null,
        },
        data: { readAt: new Date() },
      }),
    ]);

    return messages.map((msg) => ({
      ...msg,
      createdAt: msg.createdAt.toISOString(),
      readAt: msg.readAt?.toISOString() ?? null,
    }));
  }

  async handleInboundMessage(input: InboundMessageInput): Promise<void> {
    if (input.messageId) {
      const existing = await this.prisma.whatsAppMessage.findUnique({
        where: { messageId: input.messageId },
        select: { id: true },
      });

      if (existing) {
        return;
      }
    }

    const inboundAt = this.parseInboundTimestamp(input.timestamp);
    const serviceWindow = new Date(inboundAt.getTime() + 24 * 3600 * 1000);

    let conv = await this.prisma.whatsAppConversation.findUnique({
      where: {
        companyId_phoneNumber: {
          companyId: input.companyId,
          phoneNumber: input.phoneNumber,
        },
      },
    });

    if (!conv) {
      const lookupCandidates = getWhatsAppNumberLookupCandidates(
        input.phoneNumber,
      );
      const debtor = await this.prisma.debtor.findFirst({
        where: {
          companyId: input.companyId,
          phoneNumber: { in: lookupCandidates },
        },
        select: { id: true },
      });

      conv = await this.prisma.whatsAppConversation.create({
        data: {
          companyId: input.companyId,
          phoneNumber: input.phoneNumber,
          debtorId: debtor?.id ?? null,
          status: 'NEW',
          lastInboundAt: inboundAt,
          serviceWindowExpiresAt: serviceWindow,
          lastMessagePreview: input.content.slice(0, 120),
          unreadCount: 1,
        },
      });
    } else {
      const isClosed = conv.status === 'CLOSED';

      await this.prisma.whatsAppConversation.update({
        where: { id: conv.id },
        data: {
          ...(isClosed ? { status: 'NEW' } : {}),
          lastInboundAt: inboundAt,
          serviceWindowExpiresAt: serviceWindow,
          lastMessagePreview: input.content.slice(0, 120),
          unreadCount: { increment: 1 },
        },
      });
    }

    await this.prisma.whatsAppMessage.create({
      data: {
        conversationId: conv.id,
        direction: 'INBOUND',
        content: input.content,
        messageId: input.messageId,
        createdAt: inboundAt,
      },
    });
  }

  async sendReply(
    companyId: string,
    conversationId: string,
    content: string,
    userId: string,
  ): Promise<void> {
    const conv = await this.prisma.whatsAppConversation.findFirst({
      where: { id: conversationId, companyId },
    });

    if (!conv) {
      throw new Error('Conversa nao encontrada.');
    }

    if (!conv.serviceWindowExpiresAt || new Date() > conv.serviceWindowExpiresAt) {
      throw new Error(
        'A janela de 24h expirou. Nao e mais possivel responder gratuitamente.',
      );
    }

    const response = await this.whatsappService.sendTextMessage({
      companyId,
      phoneNumber: conv.phoneNumber,
      text: content,
    });

    await this.prisma.whatsAppMessage.create({
      data: {
        conversationId: conv.id,
        direction: 'OUTBOUND',
        content,
        messageId: response.messageId,
        status: response.status,
      },
    });

    await this.prisma.whatsAppConversation.update({
      where: { id: conv.id },
      data: {
        lastMessagePreview: content.slice(0, 120),
        status: conv.status === 'NEW' ? 'IN_PROGRESS' : conv.status,
        assigneeId: conv.assigneeId ?? userId,
        unreadCount: 0,
      },
    });

    this.logger.log(`Resposta enviada na conversa ${conv.id}`);
  }

  async updateStatus(
    companyId: string,
    conversationId: string,
    status: ConversationStatus,
  ): Promise<void> {
    const result = await this.prisma.whatsAppConversation.updateMany({
      where: { id: conversationId, companyId },
      data: { status },
    });

    if (result.count === 0) {
      throw new Error('Conversa nao encontrada.');
    }
  }

  async updateAssignee(
    companyId: string,
    conversationId: string,
    assigneeId: string | null,
  ): Promise<void> {
    if (assigneeId) {
      const user = await this.prisma.user.findFirst({
        where: { id: assigneeId, companyId },
        select: { id: true },
      });
      if (!user) throw new Error('Usuario nao pertence a esta empresa.');
    }

    const result = await this.prisma.whatsAppConversation.updateMany({
      where: { id: conversationId, companyId },
      data: { assigneeId },
    });

    if (result.count === 0) {
      throw new Error('Conversa nao encontrada.');
    }
  }

  async getUnreadCount(companyId: string): Promise<number> {
    return this.prisma.whatsAppConversation.count({
      where: { companyId, status: { not: 'CLOSED' }, unreadCount: { gt: 0 } },
    });
  }

  private parseInboundTimestamp(timestamp: string | undefined): Date {
    if (!timestamp) {
      return new Date();
    }

    const numericTimestamp = Number(timestamp);
    const date = Number.isFinite(numericTimestamp)
      ? new Date(numericTimestamp * 1000)
      : new Date(timestamp);

    return Number.isNaN(date.getTime()) ? new Date() : date;
  }
}
