import { Injectable } from '@nestjs/common';
import { ConversationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WhatsAppConversationService {
  constructor(private readonly prisma: PrismaService) {}

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
        serviceWindowExpiresAt:
          conv.serviceWindowExpiresAt?.toISOString() ?? null,
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
      serviceWindowExpiresAt:
        conv.serviceWindowExpiresAt?.toISOString() ?? null,
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
}
