import { Injectable, NotFoundException } from '@nestjs/common';
import { CommunicationChannel, ConversationStatus } from '@prisma/client';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { PrismaService } from '../prisma/prisma.service';

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
    });
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
