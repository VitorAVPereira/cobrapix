import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeDocument } from './checkout-rules';
import { CheckoutWebhooksService } from './checkout-webhooks.service';

type Client = Prisma.TransactionClient | PrismaService;

export const LEAD_ABANDON_MS = 30 * 60_000;
export const RECOVERY_WINDOW_MS = 30 * 86_400_000;
export const ANONYMIZE_AFTER_MS = 365 * 86_400_000;
export const CSV_LIMIT = 5000;
const UNPAID = ['EXPIRED', 'FAILED'] as const;
const BOM = String.fromCharCode(0xfeff);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface LeadInput {
  sessionKey: string;
  name?: string | null;
  email?: string | null;
  document?: string | null;
  phone?: string | null;
  utm?: Record<string, string> | null;
}

export interface RecoveryQuery {
  kind?: 'PIX' | 'LEAD';
  productId?: string;
  from?: Date;
  to?: Date;
  state: 'OPEN' | 'RECOVERED';
  page: number;
  pageSize: number;
}

export interface RecoveryItem {
  id: string;
  kind: 'PIX' | 'LEAD';
  reason: string;
  productId: string;
  productName: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  document: string | null;
  totalCents: number | null;
  createdAt: Date;
  recovered: boolean;
}

/** Only what was typed correctly is kept; nothing else about the visitor. */
function cleanLead(input: LeadInput) {
  const email = input.email?.trim().toLowerCase() ?? '';
  const phone = input.phone?.replace(/\D/g, '') ?? '';
  return {
    name: input.name?.trim().slice(0, 120) || null,
    email: EMAIL.test(email) && email.length <= 160 ? email : null,
    phone: /^\d{10,11}$/.test(phone) ? phone : null,
    document: input.document ? normalizeDocument(input.document) : null,
  };
}

/** A cell that would start a spreadsheet formula is kept as text. */
function csvCell(value: string | number | null): string {
  let text = value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",;\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The visit became an order: the lead is no longer someone who left. */
export async function markConverted(
  client: Client,
  productId: string,
  sessionKey: string,
  orderId: string,
) {
  await client.checkoutLead.updateMany({
    where: { productId, sessionKey, convertedOrderId: null },
    data: { convertedOrderId: orderId },
  });
}

/**
 * A payment recovers the same buyer's unpaid orders and leads for the
 * same product from the 30 days before it.
 */
export async function markRecovered(
  client: Client,
  order: {
    id: string;
    companyId: string;
    productId: string;
    buyerDocument: string;
    buyerEmail: string;
    paidAt: Date;
  },
) {
  const since = new Date(order.paidAt.getTime() - RECOVERY_WINDOW_MS);
  await client.checkoutOrder.updateMany({
    where: {
      companyId: order.companyId,
      productId: order.productId,
      buyerDocument: order.buyerDocument,
      status: { in: [...UNPAID] },
      createdAt: { gte: since },
      id: { not: order.id },
      recoveredByOrderId: null,
    },
    data: { recoveredByOrderId: order.id },
  });
  await client.checkoutLead.updateMany({
    where: {
      companyId: order.companyId,
      productId: order.productId,
      createdAt: { gte: since },
      recoveredByOrderId: null,
      OR: [{ convertedOrderId: null }, { convertedOrderId: { not: order.id } }],
      AND: [
        {
          OR: [{ document: order.buyerDocument }, { email: order.buyerEmail }],
        },
      ],
    },
    data: { recoveredByOrderId: order.id },
  });
}

@Injectable()
export class CheckoutRecoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: CheckoutWebhooksService,
  ) {}

  /**
   * What the buyer typed before generating the Pix. Needs an e-mail or a
   * mobile; a visit already turned into an order is left alone.
   */
  async captureLead(slug: string, input: LeadInput, now = new Date()) {
    const product = await this.prisma.checkoutProduct.findFirst({
      where: {
        slug,
        active: true,
        company: { product: 'CHECKOUT', status: 'ACTIVE' },
      },
      select: { id: true, companyId: true },
    });
    if (!product) throw new NotFoundException('Produto não encontrado.');
    const data = cleanLead(input);
    if (!data.email && !data.phone) return { saved: false };
    const filled = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== null),
    );
    const utm =
      input.utm && Object.keys(input.utm).length
        ? (input.utm as Prisma.InputJsonValue)
        : undefined;
    await this.prisma.checkoutLead.upsert({
      where: {
        productId_sessionKey: {
          productId: product.id,
          sessionKey: input.sessionKey,
        },
      },
      create: {
        companyId: product.companyId,
        productId: product.id,
        sessionKey: input.sessionKey,
        ...filled,
        ...(utm ? { utm } : {}),
        lastSeenAt: now,
      },
      update: { ...filled, lastSeenAt: now },
    });
    return { saved: true };
  }

  /** Leads quiet for 30 minutes without an order: one notice each. */
  async notifyAbandoned(now = new Date()) {
    const leads = await this.prisma.checkoutLead.findMany({
      where: {
        convertedOrderId: null,
        abandonedNotifiedAt: null,
        anonymizedAt: null,
        lastSeenAt: { lt: new Date(now.getTime() - LEAD_ABANDON_MS) },
      },
      include: { product: { select: { name: true } } },
      orderBy: { lastSeenAt: 'asc' },
      take: 100,
    });
    for (const lead of leads) {
      const marked = await this.prisma.checkoutLead.updateMany({
        where: {
          id: lead.id,
          abandonedNotifiedAt: null,
          convertedOrderId: null,
        },
        data: { abandonedNotifiedAt: now },
      });
      if (marked.count !== 1) continue;
      await this.webhooks.emit(
        this.prisma,
        lead.companyId,
        'lead.abandoned',
        null,
        {
          lead: {
            id: lead.id,
            productId: lead.productId,
            productName: lead.product.name,
            name: lead.name,
            email: lead.email,
            phone: lead.phone,
            document: lead.document,
            utm: lead.utm,
            lastSeenAt: lead.lastSeenAt.toISOString(),
          },
        },
        now,
      );
    }
  }

  async list(companyId: string, query: RecoveryQuery, now = new Date()) {
    const recovered =
      query.state === 'RECOVERED'
        ? { recoveredByOrderId: { not: null } }
        : { recoveredByOrderId: null };
    const created = {
      ...(query.from ? { gte: query.from } : {}),
      ...(query.to ? { lt: query.to } : {}),
    };
    const orderWhere: Prisma.CheckoutOrderWhereInput = {
      companyId,
      status: { in: [...UNPAID] },
      anonymizedAt: null,
      ...recovered,
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.from || query.to ? { createdAt: created } : {}),
    };
    const leadWhere: Prisma.CheckoutLeadWhereInput = {
      companyId,
      convertedOrderId: null,
      anonymizedAt: null,
      lastSeenAt: { lt: new Date(now.getTime() - LEAD_ABANDON_MS) },
      ...recovered,
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.from || query.to ? { createdAt: created } : {}),
    };
    const take = query.page * query.pageSize;
    const [orderCount, leadCount, orders, leads] = await Promise.all([
      query.kind === 'LEAD'
        ? 0
        : this.prisma.checkoutOrder.count({ where: orderWhere }),
      query.kind === 'PIX'
        ? 0
        : this.prisma.checkoutLead.count({ where: leadWhere }),
      query.kind === 'LEAD'
        ? []
        : this.prisma.checkoutOrder.findMany({
            where: orderWhere,
            orderBy: { createdAt: 'desc' },
            take,
            include: { product: { select: { name: true } } },
          }),
      query.kind === 'PIX'
        ? []
        : this.prisma.checkoutLead.findMany({
            where: leadWhere,
            orderBy: { createdAt: 'desc' },
            take,
            include: { product: { select: { name: true } } },
          }),
    ]);
    const items: RecoveryItem[] = [
      ...orders.map((order) => ({
        id: order.id,
        kind: 'PIX' as const,
        reason: order.status === 'FAILED' ? 'Pix não gerado' : 'Pix não pago',
        productId: order.productId,
        productName: order.product.name,
        name: order.buyerName,
        email: order.buyerEmail,
        phone: order.buyerPhone,
        document: order.buyerDocument,
        totalCents: order.totalCents,
        createdAt: order.createdAt,
        recovered: Boolean(order.recoveredByOrderId),
      })),
      ...leads.map((lead) => ({
        id: lead.id,
        kind: 'LEAD' as const,
        reason: 'Saiu antes de gerar o Pix',
        productId: lead.productId,
        productName: lead.product.name,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        document: lead.document,
        totalCents: null,
        createdAt: lead.createdAt,
        recovered: Boolean(lead.recoveredByOrderId),
      })),
    ]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice((query.page - 1) * query.pageSize, take);
    return {
      total: orderCount + leadCount,
      page: query.page,
      pageSize: query.pageSize,
      items,
    };
  }

  /** The filtered list as CSV; who exported what goes to the audit log. */
  async csv(
    companyId: string,
    userId: string,
    query: Omit<RecoveryQuery, 'page' | 'pageSize'>,
    now = new Date(),
  ) {
    const { items } = await this.list(
      companyId,
      { ...query, page: 1, pageSize: CSV_LIMIT },
      now,
    );
    const header = [
      'tipo',
      'motivo',
      'produto',
      'nome',
      'email',
      'celular',
      'cpf_cnpj',
      'valor',
      'data',
      'recuperado',
    ];
    const rows = items.map((item) =>
      [
        item.kind === 'PIX' ? 'Pix' : 'Lead',
        item.reason,
        item.productName,
        item.name,
        item.email,
        item.phone,
        item.document,
        item.totalCents === null ? null : (item.totalCents / 100).toFixed(2),
        item.createdAt.toISOString(),
        item.recovered ? 'sim' : 'não',
      ]
        .map(csvCell)
        .join(';'),
    );
    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'CHECKOUT_RECOVERY_EXPORTED',
        entityType: 'CheckoutRecovery',
        entityId: companyId,
        changes: {
          rows: items.length,
          kind: query.kind ?? 'ALL',
          state: query.state,
          productId: query.productId ?? null,
          from: query.from?.toISOString() ?? null,
          to: query.to?.toISOString() ?? null,
        },
      },
    });
    // BOM: spreadsheets in pt-BR open the accents right.
    return `${BOM}${[header.join(';'), ...rows].join('\r\n')}\r\n`;
  }

  /**
   * After 12 months, people who did not buy are forgotten: unpaid orders,
   * leads and the webhook bodies that carried them lose their personal data.
   * Paid orders stay (tax duties and disputes).
   */
  async anonymize(now = new Date()) {
    const cutoff = new Date(now.getTime() - ANONYMIZE_AFTER_MS);
    for (;;) {
      const orders = await this.prisma.checkoutOrder.findMany({
        where: {
          status: { in: [...UNPAID] },
          anonymizedAt: null,
          createdAt: { lt: cutoff },
        },
        select: { id: true },
        take: 500,
      });
      if (!orders.length) break;
      const ids = orders.map((order) => order.id);
      await this.prisma.$transaction([
        this.prisma.checkoutOrder.updateMany({
          where: { id: { in: ids }, anonymizedAt: null },
          data: {
            buyerName: 'Anonimizado',
            buyerEmail: '',
            buyerDocument: '',
            buyerPhone: '',
            utm: Prisma.DbNull,
            anonymizedAt: now,
          },
        }),
        this.prisma.checkoutWebhookDelivery.updateMany({
          where: { orderId: { in: ids } },
          data: { payload: { anonymized: true } },
        }),
      ]);
    }
    for (;;) {
      const leads = await this.prisma.checkoutLead.findMany({
        where: { anonymizedAt: null, createdAt: { lt: cutoff } },
        select: { id: true },
        take: 200,
      });
      if (!leads.length) break;
      const ids = leads.map((lead) => lead.id);
      // The notice goes out ~30 min after the lead, so it is found by the
      // lead id inside the body, not by its own date.
      await this.prisma.$transaction([
        this.prisma.checkoutLead.updateMany({
          where: { id: { in: ids }, anonymizedAt: null },
          data: {
            name: null,
            email: null,
            document: null,
            phone: null,
            utm: Prisma.DbNull,
            anonymizedAt: now,
          },
        }),
        this.prisma.checkoutWebhookDelivery.updateMany({
          where: {
            eventType: 'lead.abandoned',
            OR: ids.map((id) => ({
              payload: { path: ['data', 'lead', 'id'], equals: id },
            })),
          },
          data: { payload: { anonymized: true } },
        }),
      ]);
    }
  }
}
