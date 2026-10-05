import { Injectable, NotFoundException } from '@nestjs/common';
import { CommunicationChannel, Prisma } from '@prisma/client';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CommunicationTokenService,
  CursorPosition,
  CursorScope,
} from './communication-token.service';
import {
  ConversationSearch,
  containsPattern,
  conversationSearch,
} from './conversation-search';

export interface TenantViewer {
  userId: string;
  companyId: string;
}

interface ConversationPageQuery {
  cursor?: string;
  limit: number;
  channel?: CommunicationChannel;
  search?: string;
}

interface MessagePageQuery {
  cursor?: string;
  limit: number;
}

export interface TenantContact {
  name: string | null;
  address: string | null;
}

const PREVIEW_LENGTH = 160;

/**
 * Company projection of the shared channel. Every query starts from messages whose
 * companyId is the session company; conversation-wide fields (status, unread count,
 * preview, profile name, other companies' messages) are never read or returned.
 */
@Injectable()
export class CommunicationsTenantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PaymentCryptoService,
    private readonly tokens: CommunicationTokenService,
  ) {}

  async listConversations(
    viewer: TenantViewer,
    query: ConversationPageQuery,
  ): Promise<{ items: unknown[]; nextCursor: string | null; total: number }> {
    const search = conversationSearch(query.search);
    const scope: CursorScope = {
      route: 'company-conversations',
      userId: viewer.userId,
      companyId: viewer.companyId,
      // An absent search keeps the scope of cursors issued before the filter existed.
      filters: { channel: query.channel ?? null, search: search?.term },
    };
    const after = query.cursor
      ? this.tokens.decodeCursor(query.cursor, scope)
      : null;
    const visible = Prisma.sql`
      FROM "CommunicationMessage" m
      JOIN "CommunicationConversation" c ON c."id" = m."conversationId"
      WHERE m."companyId" = ${viewer.companyId}
        AND m."retentionExpiresAt" > now()
        ${query.channel ? Prisma.sql`AND c."channel" = ${query.channel}::"CommunicationChannel"` : Prisma.empty}
        ${search ? searchCondition(viewer.companyId, search) : Prisma.empty}`;
    const [rows, counted] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          id: string;
          channel: CommunicationChannel;
          lastAt: string;
          count: number;
        }>
      >(Prisma.sql`
      SELECT m."conversationId" AS "id", c."channel" AS "channel",
        to_char(max(m."createdAt"), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "lastAt",
        count(*)::int AS "count"
      ${visible}
      GROUP BY m."conversationId", c."channel"
      ${
        after
          ? Prisma.sql`HAVING (max(m."createdAt"), m."conversationId") < (${after.at.toISOString()}::timestamp(3), ${after.id})`
          : Prisma.empty
      }
      ORDER BY max(m."createdAt") DESC, "id" DESC
      LIMIT ${query.limit + 1}`),
      this.prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
      SELECT count(DISTINCT m."conversationId")::int AS "total"
      ${visible}`),
    ]);
    // Timestamps are stored as UTC; text avoids any driver timezone interpretation of the cursor.
    const page = rows
      .slice(0, query.limit)
      .map((row) => ({ ...row, lastAt: new Date(row.lastAt) }));
    const ids = page.map((row) => row.id);
    const [latest, headers] = await Promise.all([
      this.latestVisible(viewer.companyId, ids),
      this.headers(viewer.companyId, ids),
    ]);
    const items = page.map((row) => {
      const last = latest.get(row.id);
      return {
        id: row.id,
        channel: row.channel,
        contact: headers.get(row.id)?.contact ?? { name: null, address: null },
        lastMessageAt: row.lastAt,
        messageCount: row.count,
        lastMessage: last
          ? {
              direction: last.direction,
              preview: last.content.slice(0, PREVIEW_LENGTH),
              status: last.status,
              messageType: last.messageType,
            }
          : null,
      };
    });
    const tail = page.at(-1);
    return {
      items,
      nextCursor:
        rows.length > query.limit && tail
          ? this.tokens.encodeCursor(scope, { at: tail.lastAt, id: tail.id })
          : null,
      total: counted[0]?.total ?? 0,
    };
  }

  async listMessages(
    viewer: TenantViewer,
    conversationId: string,
    query: MessagePageQuery,
  ): Promise<{
    conversation: {
      id: string;
      channel: CommunicationChannel;
      contact: TenantContact;
    };
    items: unknown[];
    nextCursor: string | null;
  }> {
    const scope: CursorScope = {
      route: 'company-conversation-messages',
      userId: viewer.userId,
      companyId: viewer.companyId,
      conversationId,
    };
    const before = query.cursor
      ? this.tokens.decodeCursor(query.cursor, scope)
      : null;
    const visible = {
      conversationId,
      companyId: viewer.companyId,
      retentionExpiresAt: { gt: new Date() },
    } satisfies Prisma.CommunicationMessageWhereInput;
    const rows = await this.prisma.communicationMessage.findMany({
      where: { ...visible, ...(before ? olderThan(before) : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: {
        id: true,
        direction: true,
        content: true,
        messageType: true,
        status: true,
        createdAt: true,
        replyToExternalMessageId: true,
        invoice: {
          select: {
            id: true,
            dueDate: true,
            originalAmount: true,
            status: true,
          },
        },
        debtor: { select: { id: true, name: true } },
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
    // Absent and unauthorized conversations are indistinguishable, even with an old cursor
    // issued before the company's messages were reattributed.
    if (
      !rows.length &&
      !(await this.prisma.communicationMessage.findFirst({
        where: visible,
        select: { id: true },
      }))
    )
      throw new NotFoundException('Conversa não encontrada.');
    const page = rows.slice(0, query.limit);
    const quoted = await this.visibleQuotes(
      viewer.companyId,
      conversationId,
      page,
    );
    const header = (await this.headers(viewer.companyId, [conversationId])).get(
      conversationId,
    );
    if (!header) throw new NotFoundException('Conversa não encontrada.');
    const { channel, contact } = header;
    const tail = page.at(-1);
    return {
      conversation: { id: conversationId, channel, contact },
      items: page.map(({ replyToExternalMessageId, ...message }) => ({
        ...message,
        // A quote of another company's (or unassigned) message is omitted, not described.
        replyTo: replyToExternalMessageId
          ? (quoted.get(replyToExternalMessageId) ?? null)
          : null,
      })),
      nextCursor:
        rows.length > query.limit && tail
          ? this.tokens.encodeCursor(scope, { at: tail.createdAt, id: tail.id })
          : null,
    };
  }

  private async latestVisible(
    companyId: string,
    conversationIds: string[],
  ): Promise<
    Map<
      string,
      {
        direction: string;
        content: string;
        status: string | null;
        messageType: string | null;
      }
    >
  > {
    if (!conversationIds.length) return new Map();
    const rows = await this.prisma.$queryRaw<
      Array<{
        conversationId: string;
        direction: string;
        content: string;
        status: string | null;
        messageType: string | null;
      }>
    >(Prisma.sql`
      SELECT DISTINCT ON (m."conversationId") m."conversationId", m."direction"::text AS "direction",
        m."content", m."status", m."messageType"
      FROM "CommunicationMessage" m
      WHERE m."companyId" = ${companyId} AND m."retentionExpiresAt" > now()
        AND m."conversationId" IN (${Prisma.join(conversationIds)})
      ORDER BY m."conversationId", m."createdAt" DESC, m."id" DESC`);
    return new Map(rows.map((row) => [row.conversationId, row]));
  }

  /**
   * Channel and contact of each conversation, read once. The company's own debtor identifies
   * the contact; otherwise the recipient it wrote to.
   */
  private async headers(
    companyId: string,
    conversationIds: string[],
  ): Promise<
    Map<string, { channel: CommunicationChannel; contact: TenantContact }>
  > {
    if (!conversationIds.length) return new Map();
    const withDebtor = await this.prisma.$queryRaw<
      Array<{
        conversationId: string;
        name: string;
        phoneNumber: string;
        email: string | null;
      }>
    >(Prisma.sql`
      SELECT DISTINCT ON (m."conversationId") m."conversationId", d."name", d."phoneNumber", d."email"
      FROM "CommunicationMessage" m
      JOIN "Debtor" d ON d."id" = m."debtorId" AND d."companyId" = m."companyId"
      WHERE m."companyId" = ${companyId} AND m."retentionExpiresAt" > now()
        AND m."conversationId" IN (${Prisma.join(conversationIds)})
      ORDER BY m."conversationId", m."createdAt" DESC, m."id" DESC`);
    const conversations = await this.prisma.communicationConversation.findMany({
      where: { id: { in: conversationIds } },
      select: {
        id: true,
        channel: true,
        recipientEncrypted: true,
        recipientAnonymizedAt: true,
      },
    });
    const result = new Map<
      string,
      { channel: CommunicationChannel; contact: TenantContact }
    >();
    for (const conversation of conversations) {
      const debtor = withDebtor.find(
        (row) => row.conversationId === conversation.id,
      );
      const recipient =
        conversation.recipientEncrypted && !conversation.recipientAnonymizedAt
          ? this.decrypt(conversation.recipientEncrypted)
          : null;
      result.set(conversation.id, {
        channel: conversation.channel,
        contact: {
          name: debtor?.name ?? null,
          address:
            recipient ??
            (conversation.channel === 'EMAIL'
              ? debtor?.email
              : debtor?.phoneNumber) ??
            null,
        },
      });
    }
    return result;
  }

  private async visibleQuotes(
    companyId: string,
    conversationId: string,
    page: Array<{ replyToExternalMessageId: string | null }>,
  ): Promise<Map<string, { id: string; direction: string; excerpt: string }>> {
    const references = [
      ...new Set(
        page
          .map((message) => message.replyToExternalMessageId)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    if (!references.length) return new Map();
    const cited = await this.prisma.communicationMessage.findMany({
      where: {
        externalMessageId: { in: references },
        conversationId,
        companyId,
        retentionExpiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        direction: true,
        content: true,
        externalMessageId: true,
      },
    });
    return new Map(
      cited.map((message) => [
        message.externalMessageId!,
        {
          id: message.id,
          direction: message.direction,
          excerpt: message.content.slice(0, PREVIEW_LENGTH),
        },
      ]),
    );
  }

  private decrypt(value: string): string | null {
    try {
      return this.crypto.decrypt(value);
    } catch {
      return null;
    }
  }
}

export function olderThan(
  position: CursorPosition,
): Prisma.CommunicationMessageWhereInput {
  return {
    OR: [
      { createdAt: { lt: position.at } },
      { createdAt: position.at, id: { lt: position.id } },
    ],
  };
}

/**
 * A conversation matches when one of the company's own visible messages names a matching
 * debtor of that same company, or when its recipient is exactly the searched phone. The
 * outer query already limits the recipient match to the company's projection.
 */
function searchCondition(
  companyId: string,
  search: ConversationSearch,
): Prisma.Sql {
  const text = containsPattern(search.term);
  const digits = search.digits ? containsPattern(search.digits) : null;
  return Prisma.sql`AND (
    EXISTS (
      SELECT 1 FROM "CommunicationMessage" sm
      JOIN "Debtor" d ON d."id" = sm."debtorId" AND d."companyId" = sm."companyId"
      WHERE sm."conversationId" = m."conversationId"
        AND sm."companyId" = ${companyId}
        AND sm."retentionExpiresAt" > now()
        AND (d."name" ILIKE ${text} OR d."email" ILIKE ${text}
          ${digits ? Prisma.sql`OR d."document" LIKE ${digits} OR d."phoneNumber" LIKE ${digits}` : Prisma.empty})
    )
    ${search.recipientHash ? Prisma.sql`OR c."recipientHash" = ${search.recipientHash}` : Prisma.empty}
  )`;
}
